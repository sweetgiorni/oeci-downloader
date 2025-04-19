export const DOWNLOAD_STATUS_CLASS = "downloadStatus";

export type DownloadState = 'complete' | 'interrupted' | 'in_progress';

export type CourtDocumentID = number;
export interface CourtDocument {
	id: CourtDocumentID;
	// The name of the event, e.g "12/12/2012 Report - Guardian".
	// Multiple images can be associated with the same event.
	event: string;
	// The label as shown on the website, e.g. "Report - Guardian"
	// This is not unique, as multiple documents in the same event can have the same name.
	label: string;

	// The label after it has been made unique.
	// This is used to avoid overwriting files with the same name.
	uniqueLabel: string;

	// The URL of the document.
	url: string;

	fileExtension?: string;
}

export interface ProcessedCourtDocument extends CourtDocument {
	// The file name as it will be saved on disk.
	// This is relative to the root of the case directory.
	relativePath: string;
}

export const CourtDocumentMap = Map<CourtDocumentID, CourtDocument>;
export type CourtDocumentMap = Map<CourtDocumentID, CourtDocument>;