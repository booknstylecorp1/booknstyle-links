// The massage license line on a pro's invite page and its link preview
// (All-States plan P13, owner Nov 14 2026). The same words as the app's
// lib/massageLicenseCore.ts, and as the copy in index.html's script (404.html
// is the same page); scripts/tests/all-states-app.test.ts checks all three
// say the same. The rows are get_pro_invite_card's "licenses" (migration 112):
// approved, unexpired credentials only. Before 112 a card has no "licenses"
// and nothing is added.
// AWAITING THE OWNER'S FINAL OK (the wording).

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function massageLicenseLine(l) {
  if (!l) return null;
  const num = clean(l.credential_number);
  if (!num) return null;
  const st = clean(l.state_code ?? l.state).toUpperCase();
  const body = clean(l.issuing_body);
  switch (l.credential_type) {
    case 'state_license':
      return st ? `Licensed massage therapist, ${st} license ${num}` : `Licensed massage therapist, license ${num}`;
    case 'state_registration':
      return st ? `Registered massage therapist, ${st} registration ${num}` : `Registered massage therapist, registration ${num}`;
    case 'local_permit':
      return body ? `Massage permit ${num}, ${body}` : `Massage permit ${num}`;
    case 'camtc':
      return `CAMTC certified massage therapist, certificate ${num}`;
    case 'national_cert':
      return `Nationally certified massage therapist (NCBTMB), certificate ${num}`;
    case 'mblex':
      return `Massage therapist, MBLEx ${num}`;
    case 'school_certificate':
      return body ? `Massage school certificate ${num}, ${body}` : `Massage school certificate ${num}`;
    default:
      return body ? `Massage credential ${num}, ${body}` : `Massage credential ${num}`;
  }
}

export function establishmentLine(l) {
  const num = clean(l?.establishment_license_number);
  if (!l || !num) return null;
  const rest = [clean(l.establishment_address), clean(l.establishment_phone)].filter(Boolean);
  return [`Establishment license ${num}`, ...rest].join(', ');
}

/**
 * The lines a pro's listing shows: one massage credential for each state they
 * hold one in (the first listed for that state), the card's state first.
 */
export function cardLicenseLines(card) {
  const list = (Array.isArray(card?.licenses) ? card.licenses : [])
    .filter((l) => l && l.category === 'massage' && clean(l.credential_number));
  const stateOf = (l) => clean(l.state_code ?? l.state).toUpperCase();
  const byState = new Map();
  for (const l of list) if (!byState.has(stateOf(l))) byState.set(stateOf(l), l);
  const st = clean(card?.state).toUpperCase();
  const own = st ? byState.get(st) : undefined;
  const picks = own ? [own, ...[...byState.values()].filter((l) => l !== own)] : [...byState.values()];
  return picks.flatMap((l) => [massageLicenseLine(l), establishmentLine(l)].filter(Boolean));
}
