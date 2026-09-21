import Image from "next/image";
import { clients } from "@/data/content";
import styles from "./PublicSections.module.css";

export default function ClientMarquee() {
  return (
    <section className={styles.clients} aria-label="주요 고객사">
      <div className={styles.clientViewport}>
        <div className={styles.clientTrack}>
          {[false, true].map((duplicate) => (
            <ul key={String(duplicate)} className={styles.clientRow} aria-hidden={duplicate || undefined}>
              {clients.map((client) => (
                <li key={client.name} className={styles.clientLogo} title={client.name}>
                  <div className={styles.clientImage}>
                    <Image
                      src={client.logo}
                      alt={duplicate ? "" : `${client.name} 로고`}
                      fill
                      sizes="160px"
                      unoptimized
                      className={styles.logoImage}
                      draggable={false}
                    />
                  </div>
                  {"supportingLabel" in client && client.supportingLabel ? (
                    <span className={styles.clientSupportingLabel}>{client.supportingLabel}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}