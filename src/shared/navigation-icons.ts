export const NAVIGATION_ICON_KEYS=['ledger','statistics','ai','data','achievements','settings','import','queue','review'] as const;
export type NavigationIconKey=typeof NAVIGATION_ICON_KEYS[number];

export const NAVIGATION_PATHS:Record<NavigationIconKey,{outline:string;solid:string}>={
 ledger:{outline:'M5 3h13v18H5z M3 7h4 M3 12h4 M3 17h4 M10 8h5 M10 12h5',solid:'M5 2h14v20H5z M8 4v16h9V4z M9 7h6v2H9z M9 11h6v2H9z M3 6h3v2H3z M3 11h3v2H3z M3 16h3v2H3z'},
 statistics:{outline:'M3 3v18h18 M6 15l5-5 4 3 6-8',solid:'M2 2h3v17h17v3H2z M6 17v-4l5-5 4 3 7-8v5l-7 7-4-3z'},
 ai:{outline:'M14 3H3v18h18V10 M3 17l5-6 5 6 3-3 5 5 M17 5h6 M20 2v6 M7 7h.01',solid:'M2 2h12v3H5v10l3-4 5 6 3-3 3 3v-7h3v12H2z M7 6h3v3H7z M19 1h2v3h3v2h-3v3h-2V6h-3V4h3z'},
 data:{outline:'M21 5c0 4-18 4-18 0s18-4 18 0v14c0 4-18 4-18 0V5 M3 12c0 4 18 4 18 0',solid:'M2 5c0-5 20-5 20 0v14c0 5-20 5-20 0z M5 7v3c3 2 11 2 14 0V7c-4 2-10 2-14 0z M5 13v4c3 2 11 2 14 0v-4c-4 2-10 2-14 0z'},
 achievements:{outline:'M3 21l4-13 10 10z M8 5V2 M15 9l4-4 M18 13h4 M11 3l2 2 M20 3l1-1',solid:'M2 22 7 7l11 11z M7 12l-2 6 7-2z M8 1h3v5H8z M17 3l3 2-5 5-2-2z M18 12h5v3h-5z M20 1h3v2h-3z'},
 settings:{outline:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0',solid:'M9 1h6l1 4 4 1 3 6-3 6-4 1-1 4H9l-1-4-4-1-3-6 3-6 4-1z M16 12a4 4 0 1 0-8 0 4 4 0 1 0 8 0'},
 import:{outline:'M3 3h18v18H3z M3 17l5-6 5 6 3-3 5 5 M7 7h.01 M14 8h6 M17 5v6',solid:'M2 2h20v20H2z M5 5v10l3-4 5 6 3-3 3 3V5z M6 6h3v3H6z M16 6h2v2h2v2h-2v2h-2v-2h-2V8h2z'},
 queue:{outline:'M3 4h18v16H3z M7 8h.01 M10 8h7 M7 12h.01 M10 12h7 M7 16h.01 M10 16h7',solid:'M2 3h20v18H2z M5 6v2h2V6z M9 6v2h10V6z M5 11v2h2v-2z M9 11v2h10v-2z M5 16v2h2v-2z M9 16v2h10v-2z'},
 review:{outline:'M8 4H4v18h16V4h-4 M8 2h8v5H8z M7 14l3 3 7-7',solid:'M7 1h10v3h4v19H3V4h4z M9 3v3h6V3z M6 14l4 4 8-8-2-2-6 6-2-2z'},
};
