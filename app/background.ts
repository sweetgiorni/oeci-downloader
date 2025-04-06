// eslint-disable-next-line import/no-unassigned-import
import './options-storage';
import sanitize from 'sanitize-filename';
import mime from 'mime';

async function downloadFile(
    caseNumber: string,
    personName: string,
    event: string,
    image: Image,
    useSubdirectory: boolean,
) {
    // TODO: revisit if I want to make subdirectories optional.
    // Windows seems to group by file type by default, so it screws
    // up the chronological order of the files.
    useSubdirectory = true;


    console.log(`Event: ${event}`);
    console.log(`Downloading ${image.url}`)


    const rootDir = `oesi-cases/${caseNumber}-${personName}`;

    // If there is only one file associated with the event, don't bother creating a new directory.
    // Otherwise, 
    // const useSubdirectory = images.length > 1;
    // First use the sanitize lib to sanitize the names,
    // then replace all whitespace with a single dash, then compact any repeating dashes.
    const sanitizedEvent = sanitize(event).replace(/\s+/g, '-').replace(/-+/g, '-');
    const sanitizedImageName = sanitize(image.imageName).replace(/\s+/g, '-').replace(/-+/g, '-');
    const filename = `${rootDir}/${sanitizedEvent}${useSubdirectory ? '/' : '-'}${sanitizedImageName}${image.fileExtension ? `.${image.fileExtension}` : ''}`;

    console.log(` to ${filename}`);


    await browser.downloads.download({
        url: image.url,
        filename: filename,
        conflictAction: 'uniquify',
        saveAs: false,
    })
    return true;

}

function handleDownloadImagesMessage(message: DownloadFileRequest, sender: any, sendResponse: any) {
    console.debug('Handling download file message');

    downloadFile(
        message.caseNumber,
        message.personName,
        message.event,
        message.image,
        message.useSubdirectory
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
async function handleMessages(message: Message | any, sender: any, sendResponse: any) {
    console.debug('Received message');
    if (message.type === 'download-file') {
        return handleDownloadImagesMessage(message as DownloadFileRequest, sender, sendResponse);
    }

    // Since `fetch` is asynchronous, must send an explicit `true`
    return true;
}

browser.runtime.onMessage.addListener(handleMessages);