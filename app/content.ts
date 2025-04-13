import { CourtDocument, CourtDocumentID, CourtDocumentMap } from "./common";
import { sendMessage, onMessage } from "./messaging";

const CASE_DOCUMENTS_PATHNAME = "/PublicAccessLogin/CaseDocuments.aspx";

const datePattern = /^(\d\d)\/(\d\d)\/(\d{4})/;
const dateReplacement = "$3-$1-$2";
const fileNamePattern = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;


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
	const eventToImageIDs: Map<string, Array<CourtDocumentID>> = new Map<string, Array<CourtDocumentID>>();
	const courtDocuments = new CourtDocumentMap();

	let lastEventName = "";
	// This forEach needs to run synchronously because of the use of the lastEventName variable.
	document.querySelectorAll<HTMLTableRowElement>("table:has(th) tr:has(:not(th))").forEach((v) => {
		const tds = v.querySelectorAll<HTMLTableCellElement>("td");
		if (!tds || tds.length == 0) {
			console.log(`tds is empty???`);
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

		if (!eventToImageIDs.has(lastEventName)) {
			eventToImageIDs.set(lastEventName, []);
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
		const courtDocument: CourtDocument = {
			id: Number(id),
			event: lastEventName,
			label: linkObj.innerText,
			uniqueLabel: '',
			url: linkObj.href,
		};
		eventToImageIDs.get(lastEventName)!.push(courtDocument.id);
		courtDocuments.set(courtDocument.id, courtDocument);
	});

	// Now that we have all the images, we can get their content types.
	for (const [, imageIDs] of eventToImageIDs) {
		const seenImageNames = new Set<string>();
		for (const imageID of imageIDs) {
			const image = courtDocuments.get(imageID);
			if (!image) {
				console.error(`Couldn't find court document with ID ${imageID}`);
				continue;
			}
			const originalImageName = image.label;
			image.uniqueLabel = image.label;
			let uniqueSuffix = 1;
			while (seenImageNames.has(image.uniqueLabel)) {
				image.uniqueLabel = `${originalImageName}-${uniqueSuffix}`;
				uniqueSuffix += 1;
			}
			seenImageNames.add(image.uniqueLabel);
			const metadata = await getFileMetadata(image.url);
			if (!metadata.ok) {
				console.error(`Failed to fetch file metadata: ${metadata.statusText}`);
				continue;
			}
			// if staus is 302 found and content type is HTML, then most likely
			// the user doesn't have access to the image.
			if (metadata.status === 302 && metadata.headers.get('Content-Type')?.includes('text/html')) {
				console.warn(`User doesn't have access to the image: ${image.url}`);
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
				image.fileExtension = fileExtension;
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
})


const assertIsCaseDocumentsPage = () => {
	if (window.location.pathname !== CASE_DOCUMENTS_PATHNAME) {
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