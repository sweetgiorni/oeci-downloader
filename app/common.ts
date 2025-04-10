
export interface Message {
	type: string;
}

export interface DownloadFileRequest extends Message {
	type: 'download-file';
	personName: string;
	caseNumber: string;
	event: string;
	image: Image;
	useSubdirectory: boolean;
	rootDir: string;
}

export interface ScrapeAndDownloadRequest extends Message {
	type: 'scrape-and-download';
}

export interface GetCaseDocumentsURL extends Message {
	type: 'get-case-documents-url';
}

export interface GetCaseDocumentsURLResponse extends Message {
	success: boolean;
	url?: string;
}

export interface Image {
	// The name of the event, e.g "12/12/2012 Report - Guardian".
	// Multiple images can be associated with the same event.
	event: string;
	// The image name as shown in the link, e.g. "Report - Guardian"
	// This is not unique, as multiple images in the same event can have the same name.
	imageName: string;
	// The URL of the image.
	url: string;
	// A reference to the row in the table where the image is located.
	// Used for download status indication.
	// row: HTMLTableRowElement;
	// The blob of the image.
	// blob?: Blob;

	fileExtension?: string;
}
