// 개발·테스트용 저장소. 운영은 ORDER_DB_URL의 DB 어댑터를 쓴다(이 저장소에는 없다).
export function createMemoryStore() {
  const rows = new Map();
  const copy = (row) => structuredClone(row);

  return {
    insert(row) {
      if (rows.has(row.id)) throw new Error(`중복 id: ${row.id}`);
      rows.set(row.id, copy(row));
      return copy(row);
    },
    update(id, patch) {
      const current = rows.get(id);
      if (!current) throw new Error(`없는 id: ${id}`);
      const next = { ...current, ...patch };
      rows.set(id, copy(next));
      return copy(next);
    },
    find(id) {
      const row = rows.get(id);
      return row ? copy(row) : null;
    },
    all() {
      return [...rows.values()].map(copy);
    },
  };
}
