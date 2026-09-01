export function customerListSearchLocation(
  pathname: string,
  currentSearch: string,
  nextQuery: string,
): string {
  const params = new URLSearchParams(currentSearch);
  if (nextQuery) {
    params.set("q", nextQuery);
  } else {
    params.delete("q");
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}