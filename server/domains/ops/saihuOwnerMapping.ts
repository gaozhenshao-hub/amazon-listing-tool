import { splitExternalOperatorNames } from './operatorNameResolution';

export type ExternalOwnerMapping = { externalName: string; sourceType: string; systemUserName?: string | null; systemUserId?: number | null; userId?: number | null; isConfirmed?: number; confirmed?: number };

/** A Sellfox-specific confirmed mapping takes precedence over a generic one.
 * Lingxing mappings never participate, including matching display names. */
export function selectSaihuOwnerMappings<T extends ExternalOwnerMapping>(rows: T[], name: string): T[] {
  const eligible = rows.filter(row => row.externalName === name && (row.isConfirmed ?? row.confirmed) === 1);
  const specific = eligible.filter(row => row.sourceType === 'saihu');
  return specific.length ? specific : eligible.filter(row => row.sourceType === 'all');
}

export function displaySaihuOwner(operator: string | null, rows: ExternalOwnerMapping[]): string | null {
  const names = splitExternalOperatorNames(operator);
  if (!names.length) return null;
  return names.map(name => {
    const selected = selectSaihuOwnerMappings(rows, name);
    const mapped = [...new Set(selected.map(row => row.systemUserName).filter((value): value is string => !!value))];
    // Missing/conflicting mappings preserve the source label, never another ERP's owner.
    return mapped.length === 1 ? mapped[0] : name;
  }).join('/');
}
