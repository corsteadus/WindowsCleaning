export interface PropertySearchParams {
  page: number;
  pageSize: number;
  search?: string;
  status: "active" | "archived" | "all";
  relationship: "owned" | "shared" | "all";
}

export function propertySearchParams(params: PropertySearchParams): PropertySearchParams {
  const search = params.search?.trim();
  return {
    ...params,
    search: search || undefined,
  };
}