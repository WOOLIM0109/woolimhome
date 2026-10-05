import type { Client } from "../data/clients.ts";

// 표기는 수동으로 승인한 이니셜과 회사 업종만 사용합니다.
// 실명이 미확인인 기존 익명 사례는 이니셜을 만들어 내지 않습니다.
export function clientDisplayName(client: Pick<Client, "realName" | "initial" | "industry" | "disclosure">): string {
  if (client.disclosure === "public") return client.realName;
  return client.initial ? `${client.initial}사 · ${client.industry}` : client.industry;
}

export function findClientDisplayCollisions(clients: readonly Client[]) {
  const labels = new Map<string, Set<string>>();
  for (const client of clients) {
    const label = clientDisplayName(client);
    const keys = labels.get(label) ?? new Set<string>();
    keys.add(client.key);
    labels.set(label, keys);
  }
  return [...labels].filter(([, keys]) => keys.size > 1).map(([label, keys]) => ({ label, keys: [...keys] }));
}
