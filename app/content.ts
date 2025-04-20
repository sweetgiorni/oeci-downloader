import { CourtDocument, FragmentID, CourtDocumentMap, DOWNLOAD_STATUS_CLASS, DownloadState, CourtDocumentID, datePattern, dateReplacement } from "./common";
import { sendMessage, onMessage } from "./messaging";
import "./content.css"


declare global {
	interface Window {
		oeciDownloaderInjected?: boolean;
	}
}
const start = async () => {
	const CASE_DOCUMENTS_PATHNAME = "/publicaccesslogin/casedocuments.aspx";

	const fileNamePattern = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;

	const courtDocumentToElement = new CourtDocumentMap<HTMLTableCellElement>();


	const getFileMetadata = (url: string): Promise<Response> => {
		return fetch(url, {
			method: 'HEAD',
			headers: {
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Encoding': 'gzip, deflate, br, zstd',
				'Cache-Control': 'no-cache',
				'Pragma': 'no-cache'
			},
		});
	}

	// function scrapeCaseNumber(): string {
	// 	let caseNumber: string = "UnknownCaseNumber";
	// 	const divSpans = document.querySelectorAll("div > span");
	// 	for (let i = 0; i < divSpans.length; i++) {
	// 		const span = divSpans[i];
	// 		const caseNoMatch = span.textContent?.match(
	// 			/^P\d+$/
	// 		);
	// 		if (caseNoMatch && span.textContent) {
	// 			caseNumber = span.textContent;
	// 		}
	// 	}
	// 	return caseNumber;
	// }


	// Returns the root directory where events are downloaded.
	async function collectDocumentMetadata(): Promise<CourtDocumentMap<CourtDocument>> {
		const eventToFragmentIDs: Map<string, Array<FragmentID>> = new Map<string, Array<FragmentID>>();
		const courtDocuments = new CourtDocumentMap<CourtDocument>();

		let lastEventName = "";
		// const limit = 5;
		document.querySelectorAll<HTMLTableRowElement>("table:has(th) tr:has(:not(th))").forEach((v) => {
			// if (courtDocuments.size >= limit) { return };
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

			if (!eventToFragmentIDs.has(lastEventName)) {
				eventToFragmentIDs.set(lastEventName, []);
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
			const documentFragmentId = href.match(/DocumentFragmentID=(\d+)/)?.[1];
			if (!documentFragmentId) {
				console.log(`Couldn't find DocumentFragmentID in link object`);
				return;
			}
			const downloadStatusTd = v.querySelector<HTMLTableCellElement>(`td.${DOWNLOAD_STATUS_CLASS}`);
			if (!downloadStatusTd) {
				// Add a td for the download status
				const downloadStatusTd = document.createElement('td');
				downloadStatusTd.classList.add(DOWNLOAD_STATUS_CLASS);
				v.appendChild(downloadStatusTd);
				courtDocumentToElement.set({ fragmentID: Number(documentFragmentId), event: lastEventName }, downloadStatusTd);
			} else {
				courtDocumentToElement.set({ fragmentID: Number(documentFragmentId), event: lastEventName }, downloadStatusTd);
			}
			const courtDocument: CourtDocument = {
				id: { fragmentID: Number(documentFragmentId), event: lastEventName },
				label: linkObj.innerText,
				uniqueLabel: '',
				url: linkObj.href,
			};
			eventToFragmentIDs.get(lastEventName)!.push(courtDocument.id.fragmentID);
			courtDocuments.set(courtDocument.id, courtDocument);

		});

		// Now that we have all the images, we can get their content types.
		for (const [event, fragmentIDs] of eventToFragmentIDs) {
			const seenDocumentNames = new Set<string>();
			for (const fragmentID of fragmentIDs) {
				const courtDocument = courtDocuments.get({ fragmentID, event });
				if (!courtDocument) {
					console.error(`Couldn't find court document with ID ${fragmentID} and event ${event}`);
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

				updateDocumentDownloadState(courtDocument.id, 'in_progress');
				let metadata: Response | undefined
				try {
					metadata = await getFileMetadata(courtDocument.url);
					if (!metadata.ok) {
						console.error(`Failed to fetch file metadata: ${metadata.statusText}`);
						updateDocumentDownloadState(courtDocument.id, 'interrupted');
						courtDocuments.delete(courtDocument.id);
						continue;
					}
				} catch (error) {
					console.error(`Error fetching file metadata`);
					console.error(error);
					updateDocumentDownloadState(courtDocument.id, 'interrupted');
					courtDocuments.delete(courtDocument.id);
					continue;
				}
				if (metadata.headers.get('Content-Type')?.includes('text/html')) {
					if (metadata.redirected && metadata.url.toLowerCase().includes('erroroccured.aspx')) {
						window.location.href = '/PublicAccessLogin/Login.aspx'
						throw new Error("Was redirected to the 'error returned' page; redirecting to login.");
					}
					// Expired session?
					if (metadata.url.toLowerCase().includes('/publicaccesslogin/login.aspx')) {
						// Immediately redirect to the login page.
						window.location.href = '/PublicAccessLogin/Login.aspx'
						throw new Error("Session expired, redirecting to login page.");
					}
					// Most likely the user doesn't have access to the image.
					console.warn(`User probably doesn't have access to the image: ${courtDocument.url} for ${event} - ${courtDocument.label}`);
					updateDocumentDownloadState(courtDocument.id, 'interrupted');
					courtDocuments.delete(courtDocument.id);
					continue;
				}
				if (!metadata.ok) {
					console.error(`Failed to fetch file metadata due to unknown error`);
					console.error(metadata);
					updateDocumentDownloadState(courtDocument.id, 'interrupted');
					courtDocuments.delete(courtDocument.id);
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