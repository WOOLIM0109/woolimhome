import { Check } from "lucide-react";
import { comparison } from "@/data/content";
import styles from "./PublicSections.module.css";

export default function ComparisonTable() {
  return (
    <table className={styles.comparison}>
      <caption className={styles.srOnly}>일반 타사와 울림컴퍼니 서비스 비교</caption>
      <colgroup>
        <col className={styles.comparisonAxis} />
        <col className={styles.comparisonOthers} />
        <col className={styles.comparisonWoolim} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">구분</th>
          <th scope="col">일반 타사</th>
          <th scope="col" className={styles.comparisonBrand}>울림컴퍼니</th>
        </tr>
      </thead>
      <tbody>
        {comparison.map((row) => (
          <tr key={row.axis}>
            <th scope="row">{row.axis}</th>
            <td data-label="일반 타사">{row.others}</td>
            <td data-label="울림컴퍼니" className={styles.comparisonValue}>
              <span>
                <Check size={23} aria-hidden="true" />
                <span>{row.woolim}</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
