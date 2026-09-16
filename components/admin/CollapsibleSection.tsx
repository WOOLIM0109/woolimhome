"use client";

import { useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";

/**
 * 접었다 폈다 하는 구역.
 *
 * 관리 화면마다 「향후 2주 일정」이 맨 위에 크게 자리를 차지하고 있었습니다.
 * 매일 보는 것은 그 아래의 작업 큐인데, 일정을 지나쳐 내려가야 했습니다.
 *
 * 접은 상태는 브라우저에 기억시킵니다. 새로고침마다 다시 접어야 하면
 * 접는 기능이 없는 것과 같습니다.
 */

const STORAGE_PREFIX = "woolim.section.";

/*
 * 브라우저 저장소는 React 바깥의 것이라 useSyncExternalStore 로 읽습니다.
 *
 * 처음에는 화면에 올라온 뒤 useEffect 안에서 setState 하는 방식이었는데,
 * 그러면 그릴 때마다 한 번 더 그리게 됩니다. 이쪽이 React 가 정한 방법입니다.
 *
 * 같은 탭에서 저장한 것은 storage 이벤트가 오지 않으므로, 직접 알립니다.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readStored(storageKey: string) {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
  } catch {
    // 사생활 보호 모드나 저장소 차단이면 읽기 자체가 튕깁니다.
    return null;
  }
}

function writeStored(storageKey: string, value: "open" | "closed") {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, value);
  } catch {
    // 기억하지 못해도 접히기는 합니다. 아무 일도 안 하는 것보다 낫습니다.
  }
  listeners.forEach((listener) => listener());
}

type CollapsibleSectionProps = {
  /** 기억할 이름. 화면마다 달라야 서로 영향을 주지 않습니다. */
  storageKey: string;
  title: string;
  description?: string;
  /** 아무것도 기억된 것이 없을 때의 모습. */
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export default function CollapsibleSection({
  storageKey,
  title,
  description,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const stored = useSyncExternalStore(
    subscribe,
    () => readStored(storageKey),
    // 서버에서는 기억된 것이 없다고 봅니다. 브라우저에 올라오면 다시 읽습니다.
    () => null,
  );
  const open = stored === null ? defaultOpen : stored === "open";

  return (
    <section className="mt-10">
      <button
        type="button"
        onClick={() => writeStored(storageKey, open ? "closed" : "open")}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-stone-50"
      >
        <ChevronDown
          size={22}
          aria-hidden
          className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span>
          <span className="block text-2xl font-bold">{title}</span>
          {description && (
            <span className="mt-1 block text-sm text-[var(--muted)]">{description}</span>
          )}
        </span>
      </button>
      {/*
        접었을 때는 그리지 않습니다. 숨기기만 하면 일정 자료를 계속 불러오므로
        접는 이유(화면과 요청을 가볍게)가 사라집니다.
      */}
      {open && <div className="mt-4">{children}</div>}
    </section>
  );
}
