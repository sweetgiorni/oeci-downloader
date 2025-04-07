import sanitize from 'sanitize-filename';
import { DownloadFileRequest, Message, GetCaseDocumentsURLResponse, Image } from './common';

declare const VENDOR: 'firefox' | 'chrome';

type SendResponse = (response?: unknown) => void;

async function downloadFile(
    caseNumber: string,
    personName: string,
    event: string,
    image: Image,
    useSubdirectory: boolean,
    rootDir: string,
) {
    // TODO: revisit if I want to make subdirectories optional.
    // Windows seems to group by file type by default, so it screws
    // up the chronological order of the files.
    useSubdirectory = true;


    console.log(`Event: ${event}`);
    console.log(`Downloading ${image.url}`)



    // If there is only one file associated with the event, don't bother creating a new directory.
    // Otherwise, 
    // const useSubdirectory = images.length > 1;
    // First use the sanitize lib to sanitize the names,
    // then replace all whitespace with a single dash, then compact any repeating dashes.
    const sanitizedEvent = sanitize(event).replace(/\s+/g, '-').replace(/-+/g, '-');
    const sanitizedImageName = sanitize(image.imageName).replace(/\s+/g, '-').replace(/-+/g, '-');
    const filename = `${rootDir}/${sanitizedEvent}${useSubdirectory ? '/' : '-'}${sanitizedImageName}${image.fileExtension ? `.${image.fileExtension}` : ''}`;

    console.log(` to ${filename}`);


    const downloadID = await browser.downloads.download({
        url: image.url,
        filename: filename,
        conflictAction: 'overwrite',
        saveAs: false,
    })
    const onDownloadChanged = (delta: browser.downloads._OnChangedDownloadDelta) => {
        if (delta.id === downloadID && delta.state && delta.state.current === 'complete') {
            browser.downloads.erase({ id: downloadID });
            // Remove the listener to avoid memory leaks
            browser.downloads.onChanged.removeListener(onDownloadChanged);
        }
    };
    browser.downloads.onChanged.addListener(onDownloadChanged);
    return true;

}

function handleDownloadImagesMessage(message: DownloadFileRequest, sender: browser.runtime.MessageSender, sendResponse: SendResponse) {
    console.debug('Handling download file message');

    downloadFile(
        message.caseNumber,
        message.personName,
        message.event,
        message.image,
        message.useSubdirectory,
        message.rootDir,
    ).then((result) => {
        console.debug('Download file result:', result);
        sendResponse({ success: result });
    }).catch((error) => {
        console.error('Error downloading file:', error);
        sendResponse({ success: false, error: error.message });
    }
    )
    return true;
}


// Event listener
async function handleMessages(message: Message | object, sender: browser.runtime.MessageSender, sendResponse: SendResponse) {
    console.debug('Received message');
    if ('type' in message && message.type === 'download-file') {
        return handleDownloadImagesMessage(message as DownloadFileRequest, sender, sendResponse);
    }

    // Since `fetch` is asynchronous, must send an explicit `true`
    return true;
}

browser.runtime.onMessage.addListener(handleMessages);

const waitForDownload = (downloadId: number) => {
    return new Promise<boolean>((resolve) => {
        const onDownloadChanged = (delta: browser.downloads._OnChangedDownloadDelta) => {
            if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
                console.debug('Download complete:', delta);
                // Remove the listener to avoid memory leaks
                browser.downloads.onChanged.removeListener(onDownloadChanged);
                resolve(true);
            }
        };
        browser.downloads.onChanged.addListener(onDownloadChanged);
    });
};

browser.action.onClicked.addListener(async (tab) => {
    // Make sure we're on the CaseDocuments page

    if (tab.url?.includes('CaseDetail.aspx')) {
        console.debug('Navigating to CaseDocuments page');
        // Send an event to the content script to have it navigate to the CaseDocuments page
        const result: GetCaseDocumentsURLResponse = await browser.tabs.sendMessage(tab.id!, {
            type: 'get-case-documents-url',
        });
        if (!result.success) {
            console.error('Failed to get case documents URL');
            return;
        }
        // Wait for the tab to load
        tab = await new Promise<browser.tabs.Tab>((resolve) => {
            const checkTab = (tabId: number, changeInfo: browser.tabs._OnUpdatedChangeInfo, updatedTab: browser.tabs.Tab) => {
                if (changeInfo.status === 'complete') {
                    browser.tabs.onUpdated.removeListener(checkTab);
                    resolve(updatedTab);
                }
            };
            browser.tabs.onUpdated.addListener(checkTab);
            browser.tabs.update(tab.id!, {
                url: result.url,
            });
        }
        );
        console.debug('Navigated to CaseDocuments page');
    }
    if (!tab.url?.includes('CaseDocuments.aspx')) return;
    const response: { success: boolean, rootDir?: string, error?: unknown } = await browser.tabs.sendMessage(tab.id!, {
        type: 'scrape-and-download',
    });
    if (!response.success) {
        console.error('Failed to scrape and download:', response.error);
        return;
    }
    console.log(`Scrape and download completed successfully to ${response.rootDir}`);
    // Open the folder in the file explorer. Since we have to refer to a specific downloaded
    // file, create a dummy file in the directory and open it.
    let url = "";
    if (VENDOR === 'firefox') {
        const blob = new Blob([], { type: "text/plain" })
        url = URL.createObjectURL(blob);
    } else {
        url = 'data:text/plain,dummy';
    }
    const dummyFile = `${response.rootDir}/dummy`;
    console.debug(`Creating dummy file ${dummyFile}`);
    const downloadId = await browser.downloads.download({
        url,
        filename: dummyFile,
        conflictAction: 'overwrite',
        saveAs: false,
    });
    // Wait for the download to complete
    if (VENDOR !== 'firefox') {
        await waitForDownload(downloadId);
    }
    console.debug(`Opening folder ${response.rootDir}`);
    await browser.downloads.show(downloadId);
    await browser.downloads.erase({ id: downloadId });
});