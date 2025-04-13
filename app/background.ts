import sanitize from 'sanitize-filename';
import { onMessage, sendMessage } from './messaging';
import * as cheerio from 'cheerio';
import { CourtDocument, CourtDocumentMap, ProcessedCourtDocument } from './common';

declare const VENDOR: 'firefox' | 'chrome' | 'edge';

const waitForDownload = (downloadId: number) => {
    return new Promise<boolean>((resolve) => {
        const onDownloadChanged = (delta: browser.downloads._OnChangedDownloadDelta) => {
            if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
                // Remove the listener to avoid memory leaks
                browser.downloads.onChanged.removeListener(onDownloadChanged);
                resolve(true);
            }
        };
        browser.downloads.onChanged.addListener(onDownloadChanged);
    });
};


const getRelativePath = (doc: CourtDocument): ProcessedCourtDocument => {
    // First use the sanitize lib to sanitize the names,
    // then replace all whitespace with a single dash, then compact any repeating dashes.
    const sanitizedEvent = sanitize(doc.event).replace(/\s+/g, '-').replace(/-+/g, '-');
    const sanitizedImageName = sanitize(doc.uniqueLabel).replace(/\s+/g, '-').replace(/-+/g, '-');
    const relativePath = `${sanitizedEvent}/${sanitizedImageName}${doc.fileExtension ? `.${doc.fileExtension}` : ''}`;
    return {
        ...doc,
        relativePath,
    };
}

const saveCourtDocument = async (doc: ProcessedCourtDocument, rootDir: string) => {
    const filename = `${rootDir}/${doc.relativePath}`;
    console.log(`Downloading ${doc.url} to ${filename}`);

    const downloadID = await browser.downloads.download({
        url: doc.url,
        filename: filename,
        conflictAction: 'overwrite',
        saveAs: false,
    })
    await waitForDownload(downloadID);
}

const getCaseMetadata = (caseDocumentsPage: cheerio.CheerioAPI): {
    caseNumber: string,
    personName: string,
} => {
    let personName: string | undefined;
    const $ = caseDocumentsPage;
    const inTheMatterOfDiv = $("body > div:last-of-type");
    if (!inTheMatterOfDiv) {
        console.error("Couldn't find button container.");
    } else {
        // Extract the name from the matter of div with a regex
        const nameMatch = inTheMatterOfDiv.text().match(
            /In the Matter of:\s+(.+)/
        );
        if (!nameMatch) {
            console.error("Couldn't find name in the matter of div.");
        } else {
            personName = nameMatch[1];
        }
    }

    const caseNoSpan = $("div > span");
    if (!caseNoSpan) {
        throw "Couldn't find case number span.";
    }
    const caseNumber = caseNoSpan.text() ?? "UnknownCaseNumber";
    if (!caseNumber) {
        throw "Couldn't find case number.";
    }
    if (!personName) {
        throw "Couldn't find person name.";
    }
    return {
        caseNumber,
        personName,
    };
};


onMessage('saveCase', async message => {
    console.debug('Handling save case details message');

    const caseDocumentsPage = cheerio.load(message.data.caseDocumentsHTML);
    const courtDocuments = new CourtDocumentMap(message.data.courtDocuments);

    const { caseNumber, personName } = getCaseMetadata(caseDocumentsPage);
    const rootDir = `oeci-cases/${caseNumber}-${personName}`;

    console.log(`Court docs in background script:`);
    console.log(courtDocuments)
    const processedCourtDocs: Map<number, ProcessedCourtDocument> = new Map<number, ProcessedCourtDocument>();
    caseDocumentsPage("table:has(th) tr:has(:not(th))").each((i, v) => {
        const tds = caseDocumentsPage("td", v);
        if (!tds || tds.length == 0) {
            console.log(`tds is empty???`);
            return true;
        }
        if (tds.length !== 3) {
            console.debug(`Found an unexpected number of tds: ${tds.length}, skipping row.`);
            return true;
        }
        const linkObj = caseDocumentsPage("a", tds[1]);
        if (!linkObj) {
            console.log(`Couldn't find link object in tds[1]`);
            return true;
        }
        // Get the DocumentFragmentID query parameter
        const href = linkObj.attr('href');
        if (!href) {
            console.log(`Couldn't find href in link object`);
            return true;
        }
        const id = href.match(/DocumentFragmentID=(\d+)/)?.[1];
        if (!id) {
            console.log(`Couldn't find DocumentFragmentID in link object`);
            return true;
        }
        // Lookup the court document in the map
        const courtDocument = courtDocuments.get(Number(id));
        if (!courtDocument) {
            console.error(`Couldn't find court document with ID ${id}`);
            return true;
        }

        const processedDoc = getRelativePath(courtDocument);
        processedCourtDocs.set(courtDocument.id, processedDoc);

        // Update the anchor link to point to the new file name
        linkObj.attr('href', processedDoc.relativePath);
        // Update the target so it opens in a new tab
        linkObj.attr('target', '_blank');

        return true;
    });

    // Start the image downloads
    const downloadPromises = [];
    for (const [, doc] of processedCourtDocs) {
        downloadPromises.push(
            saveCourtDocument(doc, rootDir)
        );
    }

    console.log('Processed court documents:');
    console.log(processedCourtDocs)
    // Download the case details HTML file
    const filename = `${rootDir}/CaseDocuments.html`;
    console.log(`Saving case details to ${filename}`);
    const cssDownloadId = await browser.downloads.download({
        url: "https://publicaccess.courts.oregon.gov/PublicAccessLogin/CSS/PublicAccess.css",
        filename: `${rootDir}/CSS/PublicAccess.css`,
        conflictAction: 'overwrite',
        saveAs: false,
    })
    waitForDownload(cssDownloadId).then(() => {
        console.debug(`Download complete: ${cssDownloadId}`);
        browser.downloads.erase({ id: cssDownloadId });
    });

    let downloadId: number;
    if (VENDOR === 'firefox') {
        // Firefox doesn't support data URLs in downloads, so we need to use a blob
        const blob = new Blob([caseDocumentsPage.html()], { type: 'text/html;charset=UTF-8' });
        const url = URL.createObjectURL(blob);
        downloadId = await browser.downloads.download({
            url: url,
            filename: filename,
            conflictAction: 'overwrite',
            saveAs: false,
        });
    } else {
        downloadId = await browser.downloads.download({
            url: 'data:text/html;charset=UTF-8,' + encodeURIComponent(caseDocumentsPage.html()),
            filename: filename,
            conflictAction: 'overwrite',
            saveAs: false,
        });
    }
    if (!downloadId) {
        console.error('Failed to download case details HTML file');
        return;
    }
    // Wait for the download to complete
    if (VENDOR !== 'firefox') {
        await waitForDownload(downloadId);
    }
    console.log('Waiting for image downloads to complete');
    try {
        await Promise.allSettled(downloadPromises);
    } catch (e) {
        console.error('Error downloading images:', e);
    }
    console.debug(`Opening folder ${rootDir}`);
    await browser.downloads.show(downloadId);
    await browser.downloads.erase({ id: downloadId });
})

browser.action.onClicked.addListener(async (tab) => {
    // Make sure we're on the CaseDocuments page
    // If the tab is not set, we can't do anything.
    if (!tab.id) {
        console.error('No tab found');
        return;
    }

    if (tab.url?.includes("publicaccess.courts.oregon.gov")) {
        // Inject the content script into the tab
        console.debug('Injecting content script');
        await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
        });
    } else return;
    if (tab.url?.includes('CaseDetail.aspx')) {
        console.debug('Navigating to CaseDocuments page');
        // Send an event to the content script to have it navigate to the CaseDocuments page
        const result = await sendMessage('getCaseDocumentsURL', undefined, {
            tabId: tab.id,
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
        // We no longer have access to the active tab; need to let user click again
        return;
    }
    if (!tab.url?.includes('CaseDocuments.aspx')) {
        console.log(`${tab.url} is not a CaseDocuments page, skipping`);
        return;
    }
    // If tab isn't set, we can't do anything.
    if (!tab.id) {
        console.error('No tab found');
        return;
    }
    const response = await sendMessage('scrapeAndDownload', undefined, {
        tabId: tab.id,
    });
    if (!response.success) {
        console.error('Failed to scrape and download:', response.error);
        return;
    }
});
