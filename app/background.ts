import sanitize from 'sanitize-filename';
import { onMessage, sendMessage } from './messaging';
import * as cheerio from 'cheerio';
import { CourtDocument, CourtDocumentID, CourtDocumentMap, datePattern, dateReplacement, DOWNLOAD_STATUS_CLASS, DownloadState, ProcessedCourtDocument } from './common';

declare const VENDOR: 'firefox' | 'chrome' | 'edge';

// If erase is true, successful downloads will be erased after completion
const waitForDownload = (downloadId: number, erase: boolean = true): Promise<DownloadState> => {
    return new Promise<DownloadState>(function (resolve) {
        const onDownloadChanged = (delta: browser.downloads._OnChangedDownloadDelta) => {
            if (delta.id === downloadId && delta.state && ['complete', 'interrupted'].includes(delta.state.current || '')) {
                // console.log(`Download ${downloadId} changed state to ${delta.state.current}`);
                // Remove the listener to avoid memory leaks
                browser.downloads.onChanged.removeListener(onDownloadChanged);
                if (erase && delta.state.current === 'complete') {
                    browser.downloads.erase({ id: downloadId });
                }
                resolve(delta.state.current as DownloadState);
            }
        };
        browser.downloads.onChanged.addListener(onDownloadChanged);
    });
};


const getRelativePath = (doc: CourtDocument): ProcessedCourtDocument => {
    // First use the sanitize lib to sanitize the names,
    // then replace all whitespace with a single dash, then compact any repeating dashes.
    const sanitizedEvent = sanitize(doc.id.event).replace(/\s+/g, '-').replace(/-+/g, '-');
    const sanitizedImageName = sanitize(doc.uniqueLabel).replace(/\s+/g, '-').replace(/-+/g, '-');
    const relativePath = `${sanitizedEvent}/${sanitizedImageName}${doc.fileExtension ? `.${doc.fileExtension}` : ''}`;
    return {
        ...doc,
        relativePath,
    };
}

const saveCourtDocument = async (doc: ProcessedCourtDocument, rootDir: string): Promise<DownloadState> => {
    const filename = `${rootDir}/${doc.relativePath}`;
    // console.log(`Downloading ${doc.url} to ${filename}`);

    const downloadID = await browser.downloads.download({
        url: doc.url,
        filename: filename,
        conflictAction: 'overwrite',
        saveAs: false,
    })
    return await waitForDownload(downloadID)
}

const getCaseMetadata = (caseDocumentsPage: cheerio.CheerioAPI): {
    caseNumber: string,
    personName: string,
} => {
    let personName: string | undefined;
    const $ = caseDocumentsPage;
    const bodyDivs = $("body > div");
    for (let i = 0; i < bodyDivs.length; i++) {
        const div = $(bodyDivs[i]);
        const nameMatch = div.text().match(
            /In the Matter of:\s+(.+)/
        );
        if (nameMatch) {
            personName = nameMatch[1];
            break;
        }
    }
    if (!personName) {
        console.error("Couldn't find person name in any div.");
        throw "Couldn't find person name.";
    }

    let caseNumber = "UnknownCaseNumber";
    const divSpans = $("div > span");
    for (let i = 0; i < divSpans.length; i++) {
        const span = $(divSpans[i]);
        const caseNoMatch = span.text().match(
            /^P\d+$/
        );
        if (caseNoMatch) {
            caseNumber = span.text();
        }
    }
    return {
        caseNumber,
        personName,
    };
};


onMessage('saveCase', async message => {
    const tabId = message.sender.tab?.id;
    if (!tabId) {
        console.error('Received saveCase message without a tab ID in the sender');
        return;
    }
    console.debug('Handling save case details message');

    const caseDocumentsPage = cheerio.load(message.data.caseDocumentsHTML);
    const courtDocuments = new CourtDocumentMap(message.data.courtDocuments);

    const { caseNumber, personName } = getCaseMetadata(caseDocumentsPage);
    const rootDir = `oeci-cases/${caseNumber}-${personName}`;

    const processedCourtDocs = new Map<CourtDocumentID, ProcessedCourtDocument>();
    // Remove the download status column that may have been added by the content script
    caseDocumentsPage(`.${DOWNLOAD_STATUS_CLASS}`).remove();
    let lastEventName = "";
    caseDocumentsPage("table:has(th) tr:has(:not(th))").each((i, v) => {
        const tds = caseDocumentsPage(`td`, v);
        if (!tds || tds.length == 0) {
            console.log(`tds is empty???`);
            return true;
        }
        if (tds.length !== 3) {
            console.debug(`Found an unexpected number of tds: ${tds.length}, skipping row.`);
            return true;
        }
        const event = caseDocumentsPage(tds[0]).text();
        if (event) {
            lastEventName = event.replace(datePattern, dateReplacement);
        }
        if (!lastEventName) {
            lastEventName = "unknown";
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
        const fragmentID = href.match(/DocumentFragmentID=(\d+)/)?.[1];
        if (!fragmentID) {
            console.log(`Couldn't find DocumentFragmentID in link object`);
            return true;
        }
        // Lookup the court document in the map
        const courtDocument = courtDocuments.get({ fragmentID: Number(fragmentID), event: lastEventName });
        if (!courtDocument) {
            console.error(`Couldn't find court document with ID ${fragmentID} and event ${lastEventName}`);
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
    const downloadPromises: Promise<void>[] = [];
    for (const [, doc] of processedCourtDocs) {
        downloadPromises.push(
            (async () => {
                const state = await saveCourtDocument(doc, rootDir)
                sendMessage('courtDocumentDownloadUpdated', {
                    id: doc.id,
                    state,
                }, {
                    tabId,
                });
            })()
        );
    }

    // Download the case details HTML file
    const documentIndexFileName = `${rootDir}/${sanitize(`${caseNumber}-${personName}`)}.html`;
    console.log(`Saving document index to ${documentIndexFileName}`);
    const cssDownloadId = await browser.downloads.download({
        url: "https://publicaccess.courts.oregon.gov/PublicAccessLogin/CSS/PublicAccess.css",
        filename: `${rootDir}/CSS/PublicAccess.css`,
        conflictAction: 'overwrite',
        saveAs: false,
    })
    await waitForDownload(cssDownloadId);

    let documentIndexDownloadId: number;
    if (VENDOR === 'firefox') {
        // Firefox doesn't support data URLs in downloads, so we need to use a blob
        const blob = new Blob([caseDocumentsPage.html()], { type: 'text/html;charset=UTF-8' });
        const url = URL.createObjectURL(blob);
        documentIndexDownloadId = await browser.downloads.download({
            url: url,
            filename: documentIndexFileName,
            conflictAction: 'overwrite',
            saveAs: false,
        });
    } else {
        documentIndexDownloadId = await browser.downloads.download({
            url: 'data:text/html;charset=UTF-8,' + encodeURIComponent(caseDocumentsPage.html()),
            filename: documentIndexFileName,
            conflictAction: 'overwrite',
            saveAs: false,
        });
    }
    if (!documentIndexDownloadId) {
        console.error('Failed to download case details HTML file');
        return;
    }
    // Wait for the download to complete
    (async function () {
        // if (VENDOR !== 'firefox') {
        // Don't erase it because we need to show it first
        await waitForDownload(documentIndexDownloadId, false);
        // }
        console.debug(`Opening folder ${rootDir}`);
        try {
            await browser.downloads.show(documentIndexDownloadId);
            await browser.downloads.erase({ id: documentIndexDownloadId });
        } catch (e) {
            console.error(`Failed to erase download ${documentIndexDownloadId}: ${e}`);
        }
    })();
    console.log('Waiting for image downloads to complete');
    try {
        await Promise.allSettled(downloadPromises);
    } catch (e) {
        console.error('Error downloading images:', e);
    }
})

const isContentScriptInjected = async (tabId: number): Promise<boolean> => {
    const [result] = await browser.scripting.executeScript({
        target: { tabId },
        func: (() => {
            return window.oeciDownloaderInjected === true;
        }) as () => void,
    });
    if (result.error) {
        console.error('Error checking if content script is injected:', result.error);
        return false;
    }
    return result.result;
}

const inject = async (tabId: number) => {
    if (await isContentScriptInjected(tabId)) {
        console.debug('Content script already injected, skipping');
        return;
    }
    await browser.scripting.executeScript({
        target: { tabId },
        injectImmediately: true,
        files: ['content.js'],
    });
}

browser.action.onClicked.addListener(async (tab) => {
    // If the tab is not set, we can't do anything.
    if (!tab.id) {
        console.error('No tab found');
        return;
    }

    // Make sure we're on the CaseDocuments page
    if (tab.url?.includes("publicaccess.courts.oregon.gov")) {
        // Inject the content script into the tab
        await inject(tab.id);
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
        if (!tab.id) {
            console.error('Failed to navigate to CaseDocuments page, new tab id is undefined');
            return;
        }
        console.debug('Navigated to CaseDocuments page, injecting content script again');
        await inject(tab.id);
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
