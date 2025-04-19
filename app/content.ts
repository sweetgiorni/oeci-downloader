import { CourtDocument, CourtDocumentID, CourtDocumentMap, DOWNLOAD_STATUS_CLASS, DownloadState } from "./common";
import { sendMessage, onMessage } from "./messaging";
import "./content.css"


declare global {
	interface Window {
		oeciDownloaderInjected?: boolean;
	}
}
const start = async () => {
	console.log("Inside content script");
	const CASE_DOCUMENTS_PATHNAME = "/publicaccesslogin/casedocuments.aspx";

	const datePattern = /^(\d\d)\/(\d\d)\/(\d{4})/;
	const dateReplacement = "$3-$1-$2";
	const fileNamePattern = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;

	const courtDocumentToElement = new Map<CourtDocumentID, HTMLTableCellElement>();


	// by a previously injected script
	// const extensionId = window.__extensionId;

	// if (!extensionId) {
	// 	console.error("Couldn't find extension ID");
	// 	throw new Error("Couldn't find extension ID");
	// }


	const getFileMetadata = (url: string): Promise<Response> => {
		return fetch(url, {
			method: 'HEAD',
			headers: {
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Encoding': 'gzip, deflate, br, zstd',
				'Cache-Control': 'no-cache',
				'Pragma': 'no-cache'
			}
		});
	}


	// Returns the root directory where events are downloaded.
	async function collectDocumentMetadata(): Promise<CourtDocumentMap> {
		const eventToCourtDocumentIDs: Map<string, Array<CourtDocumentID>> = new Map<string, Array<CourtDocumentID>>();
		const courtDocuments = new CourtDocumentMap();

		let lastEventName = "";
		document.querySelectorAll<HTMLTableRowElement>("table:has(th) tr:has(:not(th))").forEach((v) => {
			const tds = v.querySelectorAll<HTMLTableCellElement>(`td:not(.${DOWNLOAD_STATUS_CLASS})`);
			if (!tds || tds.length == 0) {
				console.log(`tds is empty???`);
				return;
			}
			if (tds.length !== 3) {
				console.debug(`Found an unexpected number of tds: ${tds.length}, skipping row.`);
				return "";
			}
			const event = tds[0].innerText;
			if (event) {
				lastEventName = event.replace(datePattern, dateReplacement);
			}
			if (!lastEventName) {
				lastEventName = "unknown";
			}

			if (!eventToCourtDocumentIDs.has(lastEventName)) {
				eventToCourtDocumentIDs.set(lastEventName, []);
			}
			const linkObj = tds[1].querySelector("a");
			if (!linkObj) {
				console.log(`Couldn't find link object in tds[1]`);
				return;
			}
			// Get the DocumentFragmentID query parameter
			const href = linkObj.getAttribute('href');
			if (!href) {
				console.log(`Couldn't find href in link object`);
				return;
			}
			const id = href.match(/DocumentFragmentID=(\d+)/)?.[1];
			if (!id) {
				console.log(`Couldn't find DocumentFragmentID in link object`);
				return;
			}
			const downloadStatusTd = v.querySelector<HTMLTableCellElement>(`td.${DOWNLOAD_STATUS_CLASS}`);
			if (!downloadStatusTd) {
				// Add a td for the download status
				const downloadStatusTd = document.createElement('td');
				downloadStatusTd.classList.add(DOWNLOAD_STATUS_CLASS);
				v.appendChild(downloadStatusTd);
				courtDocumentToElement.set(Number(id), downloadStatusTd);
			} else {
				courtDocumentToElement.set(Number(id), downloadStatusTd);
			}
			const courtDocument: CourtDocument = {
				id: Number(id),
				event: lastEventName,
				label: linkObj.innerText,
				uniqueLabel: '',
				url: linkObj.href,
			};
			eventToCourtDocumentIDs.get(lastEventName)!.push(courtDocument.id);
			courtDocuments.set(courtDocument.id, courtDocument);

		});

		// Now that we have all the images, we can get their content types.
		for (const [, documentIDs] of eventToCourtDocumentIDs) {
			const seenDocumentNames = new Set<string>();
			for (const documentID of documentIDs) {
				const courtDocument = courtDocuments.get(documentID);
				if (!courtDocument) {
					console.error(`Couldn't find court document with ID ${documentID}`);
					continue;
				}
				const originalDocumentName = courtDocument.label;
				courtDocument.uniqueLabel = courtDocument.label;
				let uniqueSuffix = 1;
				while (seenDocumentNames.has(courtDocument.uniqueLabel)) {
					courtDocument.uniqueLabel = `${originalDocumentName}-${uniqueSuffix}`;
					uniqueSuffix += 1;
				}
				seenDocumentNames.add(courtDocument.uniqueLabel);
				console.log(courtDocument.uniqueLabel)

				updateDocumentDownloadState(courtDocument.id, 'in_progress');
				const metadata = await getFileMetadata(courtDocument.url);
				if (!metadata.ok) {
					console.error(`Failed to fetch file metadata: ${metadata.statusText}`);
					continue;
				}
				// if staus is 302 found and content type is HTML, then most likely
				// the user doesn't have access to the image.
				if (metadata.status === 302 && metadata.headers.get('Content-Type')?.includes('text/html')) {
					console.warn(`User doesn't have access to the image: ${courtDocument.url}`);
					continue;
				}
				let fileExtension = "";
				const matches = metadata.headers.get('Content-Disposition')?.match(fileNamePattern);
				if (matches && matches[1]) {
					// The filename is in the second group of the regex match.
					// The first group is the quote character.
					if (matches != null && matches[1]) {
						const filename = matches[1].replace(/['"]/g, '');
						// Get the file extension from the filename.
						fileExtension = filename.split('.').pop() ?? "";
					}
					// If the content type is HTML, 
					courtDocument.fileExtension = fileExtension;
				}
			}
		}
		return courtDocuments;
	}

	const getCaseDocumentsUpdateStateURL = (): string | undefined => {
		const urlEl = document.querySelector(".ssCaseDetailCaseNbr")?.parentElement as HTMLAnchorElement;
		if (!urlEl) {
			console.error("Couldn't find case documents link.");
			return;
		}
		const url = urlEl.href;
		if (!url) {
			console.error("Couldn't find case documents URL.");
			return;
		}
		return url;

	}

	onMessage('getCaseDocumentsURL', () => {
		const url = getCaseDocumentsUpdateStateURL();
		if (url) {
			return ({ success: true, url });
		} else {
			return ({ success: false });
		}
	});


	const assertIsCaseDocumentsPage = () => {
		if (window.location.pathname.toLowerCase() !== CASE_DOCUMENTS_PATHNAME) {
			throw new Error("Not on CaseDocuments page");
		}
	}


	const getCaseDocumentsHTML = async (): Promise<string> => {
		assertIsCaseDocumentsPage();
		return new XMLSerializer().serializeToString(document.documentElement);
	}



	onMessage('scrapeAndDownload', async () => {
		try {
			assertIsCaseDocumentsPage();
		}
		catch (e) {
			console.error(e);
			return { success: false, error: e };
		}
		try {
			const caseDocumentsPromise = getCaseDocumentsHTML();
			const caseDocumentMetadataPromise = collectDocumentMetadata();
			sendMessage('saveCase', {
				courtDocuments: Array.from((await caseDocumentMetadataPromise).entries()),
				caseDocumentsHTML: await caseDocumentsPromise,
			});
		} catch (error) {
			console.error('Error getting case details or documents:', error);
			return { success: false, error };
		}

		return { success: true };
	})


	const updateDocumentDownloadState = (id: CourtDocumentID, state: DownloadState) => {
		const element = courtDocumentToElement.get(id);
		if (!element) {
			console.warn(`Couldn't find element for court document with ID ${id}`);
			return;
		}
		if (state === 'in_progress') {
			element.classList.add('in_progress');
			element.classList.remove('complete', 'interrupted');
			element.innerHTML = "";
		} else if (state === 'complete') {
			element.classList.remove('in_progress');
			element.classList.add('complete');
			element.innerHTML = "<span style='color: green;'>✔</span>";
		} else if (state === 'interrupted') {
			element.classList.remove('in_progress');
			element.classList.add('interrupted');
			element.innerHTML = "<span style='color: red;'>✘</span>";
		}
	}

	onMessage('courtDocumentDownloadUpdated', async (message) => {
		const { id, state } = message.data;
		updateDocumentDownloadState(id, state);
		return;
	});

};

if (window.oeciDownloaderInjected === true) {
	console.log("Already injected, skipping.");
} else {
window.oeciDownloaderInjected = true;
start();
}