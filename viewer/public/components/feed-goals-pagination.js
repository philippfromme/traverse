// Reserve a category heading again when its goals continue onto another page.
export function paginateGoals(items, availableHeight, headings, categoryGap, rowGap) {
  const pages = [];
  let page = [], used = 0, category = null;
  for (const item of items) {
    const cost = () => item.height + (category === item.category ? rowGap : (page.length ? categoryGap : 0) + headings[item.category]);
    if (page.length && used + cost() > availableHeight) {
      pages.push(page);
      page = []; used = 0; category = null;
    }
    used += cost();
    page.push(item.id);
    category = item.category;
  }
  if (page.length) pages.push(page);
  return pages;
}
