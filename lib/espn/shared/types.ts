export interface EspnRef {
  $ref: string;
}

export interface EspnItemsResponse<T> {
  items: T[];
  count: number;
  pageCount?: number;
  pageIndex?: number;
  pageSize?: number;
}
