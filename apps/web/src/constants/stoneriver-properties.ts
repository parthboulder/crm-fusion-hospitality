/**
 * Canonical property list for the Stoneriver HG portfolio (21 properties).
 * Always render all rows even when daily report data is missing.
 */

export interface Property {
  name: string;
  group: string;
  state: string;
}

export const PROPERTIES: Property[] = [
  { name: 'HGI Olive Branch', group: 'Hilton', state: 'MS' },
  { name: 'Tru By Hilton Tupelo', group: 'Hilton', state: 'MS' },
  { name: 'Hampton Inn Vicksburg', group: 'Hilton', state: 'MS' },
  { name: 'DoubleTree Biloxi', group: 'Hilton', state: 'MS' },
  { name: 'Home2 Suites By Hilton', group: 'Hilton Extended', state: 'MS' },
  { name: 'Hilton Garden Inn Madison', group: 'Hilton Extended', state: 'MS' },
  { name: 'Hilton Garden Inn Meridian', group: 'Hilton Extended', state: 'MS' },
  { name: 'Hampton Inn Meridian', group: 'Hilton Extended', state: 'MS' },
  { name: 'Holiday Inn Meridian', group: 'IHG', state: 'MS' },
  { name: 'Candlewood Suites', group: 'IHG', state: 'MS' },
  { name: 'Holiday Inn Express Fulton', group: 'IHG', state: 'MS' },
  { name: 'Holiday Inn Express Memphis Southwind', group: 'IHG', state: 'TN' },
  { name: 'Holiday Inn Express Tupelo', group: 'IHG', state: 'MS' },
  { name: 'Holiday Inn Tupelo', group: 'IHG', state: 'MS' },
  { name: 'Four Points Memphis Southwind', group: 'Marriott', state: 'TN' },
  { name: 'TownePlace Suites', group: 'Marriott', state: 'MS' },
  { name: 'Best Western Tupelo', group: 'Best Western', state: 'MS' },
  { name: 'SureStay Hotel', group: 'Best Western', state: 'MS' },
  { name: 'Best Western Plus Olive Branch', group: 'Best Western', state: 'MS' },
  { name: 'Hyatt Place Biloxi', group: 'Hyatt', state: 'MS' },
  { name: 'Comfort Inn Tupelo', group: 'Choice', state: 'MS' },
];

export const GROUP_ORDER = [
  'Hilton',
  'Hilton Extended',
  'IHG',
  'Marriott',
  'Best Western',
  'Hyatt',
  'Choice',
];
