import { CourtDocument } from './common';

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
        courtDocuments: [number, CourtDocument][];
    }): void;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
