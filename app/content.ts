import optionsStorage from './options-storage';

const datePattern = /^(\d\d)\/(\d\d)\/(\d{4})/;
const dateReplacement = "$3-$1-$2";
const fileNamePattern = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;

var personName: string | null = null;


const getFileMetadata = (url: string): Promise<Response> => {
	// First, send a HEAD request to get the content type
	return fetch(url, {
		method: 'HEAD',
		headers: {
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Encoding': 'gzip, deflate, br, zstd',
			'Cache-Control': 'no-cache',
			'Pragma': 'no-cache'
		}
	});

	// if (!response.ok) {
	//     // TODO: Propagate the error to the UI
	//     console.error(`Failed to fetch image: ${response.statusText}`);
	//     return;
	// }
}

async function scrapeAndDownload() {
	// const options = await optionsStorage.getAll();
	const inTheMatterOfDiv = document.querySelector("body > div:last-of-type");
	if (!inTheMatterOfDiv) {
		console.error("Couldn't find button container.");
		return;
	}
	// Extract the name from the matter of div with a regex
	const nameMatch = inTheMatterOfDiv.textContent?.match(
		/In the Matter of:\s+(.+)/
	);
	if (!nameMatch) {
		console.error("Couldn't find name in the matter of div.");
	} else {
		personName = nameMatch[1];
		console.log(`Protected person name: ${personName}`);
	}

	const eventToImages: Map<string, Array<Image>> = new Map<string, Array<Image>>();

	const caseNoSpan = document.querySelector("div > span");
	if (!caseNoSpan) {
		throw "Couldn't find case number span.";
	}
	const caseNumber = caseNoSpan.textContent ?? "UnknownCaseNumber";
	var lastEventName = "";
	// This forEach needs to run synchronously because of the use of the lastEventName variable.
	document.querySelectorAll<HTMLTableRowElement>("table:has(th) tr:has(:not(th)").forEach((v) => {
		const tds = v.querySelectorAll<HTMLTableCellElement>("td");
		if (!tds || tds.length == 0) {
			console.log(`tds is empty???`);
		}
		if (tds.length !== 3) {
			console.debug(`Found an unexpected number of tds: ${tds.length}, skipping row.`);
			return;
		}
		const event = tds[0].innerText;
		if (event) {
			lastEventName = event.replace(datePattern, dateReplacement);
		}
		if (!lastEventName) {
			lastEventName = "unknown";
		}

		if (!eventToImages.has(lastEventName)) {
			eventToImages.set(lastEventName, []);
		}
		const linkObj = tds[1].querySelector("a");
		if (!linkObj) {
			console.log(`Couldn't find link object in tds[1]`);
			return;
		}
		const image: Image = {
			event: lastEventName,
			imageName: linkObj.innerText,
			url: linkObj.href,
		};
		eventToImages.get(lastEventName)!.push(image);
	});

	// Now that we have all the images, we can get their content types.
	for (const [event, images] of eventToImages) {
		console.log(event)
		for (const image of images) {
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
			var fileExtension = "";
			var matches = metadata.headers.get('Content-Disposition')?.match(fileNamePattern);
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
				console.log(image)

				await browser.runtime.sendMessage({
					type: 'download-file',
					personName,
					caseNumber,
					event,
					image,
					useSubdirectory: images.length > 1,
				} as DownloadFileRequest);

				// Sleep to avoid overwhelming the server.
				await new Promise((resolve) => setTimeout(resolve, 300));
			}
		}

	}

}

// scrapeAndDownload();


// Listen for messages from the background script
browser.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
	if (message.type === 'scrape-and-download') {
		scrapeAndDownload().then(() => {
			sendResponse({ success: true });
		}).catch((error) => {
			console.error('Error scraping and downloading:', error);
			sendResponse({ success: false, error: error.message });
		});
		return true; // Keep the message channel open for sendResponse
	}
});