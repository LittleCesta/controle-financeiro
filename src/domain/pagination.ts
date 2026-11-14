export const PAGE_SIZE = 10;

// Fatia uma lista em páginas. A página pedida vem da URL, então qualquer lixo
// ("abc", 0, -3, 999) vira uma página válida em vez de erro ou lista vazia.
export function paginate<T>(items: T[], requested: unknown, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const n = Number.parseInt(String(requested), 10);
  const page = Number.isFinite(n) ? Math.min(Math.max(n, 1), pages) : 1;
  return { items: items.slice((page - 1) * size, page * size), page, pages, total: items.length };
}
