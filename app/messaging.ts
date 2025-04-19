import { CourtDocument, DownloadState, CourtDocumentID } from './common';

import { defineExtensionMessaging } from '@webext-core/messaging';


export type DownloadFileRequest = {
    personName?: string;
    caseNumber: string;
    event: string;
    image: CourtDocument;
    useSubdirectory: boolean;
    rootDir: string;
}


interface ProtocolMap {
    downloadFile(req: DownloadFileRequest): void;

    getCaseDocumentsURL(): {
        success: boolean;
        error?: unknown;
        url?: string;
    }

    scrapeAndDownload(): {
        success: boolean;
        error?: unknown;
    };

    saveCase(req: {
        caseDocumentsHTML: string;
        courtDocuments: [CourtDocumentID, CourtDocument][];
    }): void;

    courtDocumentDownloadUpdated(req: {
        id: CourtDocumentID;
        state: DownloadState;
    }): void;
}

export const { sendMessage, onMessage, removeAllListeners } = defineExtensionMessaging<ProtocolMap>({
    // logger: console,
});
