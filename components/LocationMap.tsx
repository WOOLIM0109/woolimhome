"use client";

import Image from "next/image";
import { Maximize2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./LocationMap.module.css";

const mapSrc = "/images/woolim-location-map.png";
const mapAlt = "초량역 12번 출구에서 시티호텔을 지나 울림컴퍼니로 오시는 길과 건물 앞 공영주차장 위치를 안내하는 약도";

export default function LocationMap() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function openMap() {
    dialogRef.current?.showModal();
    setIsOpen(true);
  }

  return (
    <div className={styles.map}>
      <button type="button" className={styles.trigger} onClick={openMap} aria-label="울림컴퍼니 약도 크게 보기" aria-haspopup="dialog">
        <Image
          src={mapSrc}
          alt={mapAlt}
          width={1659}
          height={948}
          sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 800px) calc(100vw - 64px), (max-width: 1100px) calc((100vw - 132px) * 6 / 11), (max-width: 1504px) calc((100vw - 152px) * 6 / 11), 738px"
        />
        <span className={styles.caption}>약도 크게 보기 <Maximize2 size={16} aria-hidden="true" /></span>
      </button>

      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={() => setIsOpen(false)}>
        <div className={styles.header}>
          <h2 id={titleId}>울림컴퍼니 약도</h2>
          <button type="button" className={styles.close} onClick={() => dialogRef.current?.close()} aria-label="약도 닫기">
            <X size={24} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.mobileHint}>약도를 좌우로 움직여 확인해 주세요.</p>
        <div className={styles.viewer}>
          {isOpen ? (
            <Image
              src={mapSrc}
              alt={mapAlt}
              width={1659}
              height={948}
              unoptimized
              className={styles.fullImage}
            />
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
