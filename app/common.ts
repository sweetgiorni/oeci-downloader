export const DOWNLOAD_STATUS_CLASS = "downloadStatus";
export const datePattern = /^(\d\d)\/(\d\d)\/(\d{4})/;
export const dateReplacement = "$3-$1-$2";
export type DownloadState = 'complete' | 'interrupted' | 'in_progress';

export interface CourtDocumentID {
	// The name of the event, e.g "12/12/2012 Report - Guardian".
	// Multiple images can be associated with the same event.
	event: string;
	// The document fragment ID. This is a unique ID for the blob, but
	// different events can refer to the same blob.
	fragmentID: FragmentID;
}
export type FragmentID = number;
export interface CourtDocument {
	id: CourtDocumentID;
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

// export const CourtDocumentMap = Map<CourtDocumentID, CourtDocument>;
// export type CourtDocumentMap = Map<CourtDocumentID, CourtDocument>;


export class CourtDocumentMap<T> implements Map<CourtDocumentID, T> {
	map: Map<string, T>;
	// Constructor that takes an array of [key, value] pairs
	// and initializes the map with them.
	constructor(entries?: readonly (readonly [CourtDocumentID, T])[]) {
		this.map = new Map<string, T>(entries?.map(([key, value]) => [this.stringifyKey(key), value]));
	}
	forEach(callbackfn: (value: T, key: CourtDocumentID, map: Map<CourtDocumentID, T>) => void, thisArg?: unknown): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}
	clear(): void {
		this.map.clear();
	}
	delete(key: CourtDocumentID): boolean {
		return this.map.delete(this.stringifyKey(key));
	}

	get(key: CourtDocumentID): T | undefined {
		return this.map.get(this.stringifyKey(key));
	}

	has(key: CourtDocumentID): boolean {
		return this.map.has(this.stringifyKey(key));
	}

	get size(): number {
		return this.map.size;
	}

	entries(): IterableIterator<[CourtDocumentID, T]> {
		const iterator = this.map.entries();
		return {
			[Symbol.iterator]() {
				return this;
			},
			next: (): IteratorResult<[CourtDocumentID, T]> => {
				const result = iterator.next();
				if (result.done) return { done: true, value: undefined };
				const [key, value] = result.value;
				return { done: false, value: [this.parseKey(key), value] };
			},
		};
	}

	keys(): IterableIterator<CourtDocumentID> {
		const iterator = this.map.keys();
		return {
			[Symbol.iterator]() {
				return this;
			},
			next: (): IteratorResult<CourtDocumentID> => {
				const result = iterator.next();
				if (result.done) return { done: true, value: undefined };
				return { done: false, value: this.parseKey(result.value) };
			},
		};
	}

	values(): IterableIterator<T> {
		return this.map.values();
	}

	[Symbol.iterator](): IterableIterator<[CourtDocumentID, T]> {
		return this.entries();
	}

	[Symbol.toStringTag]: string = "CourtDocumentMap";
	set(key: CourtDocumentID, value: T): this {
		this.map.set(this.stringifyKey(key), value);
		return this;
	}
	private stringifyKey(key: CourtDocumentID): string {
		return `${key.event}\0${key.fragmentID}`;
	}
	private parseKey(key: string): CourtDocumentID {
		const [event, fragmentID] = key.split("\0");
		return { event, fragmentID: Number(fragmentID) };
	}
}