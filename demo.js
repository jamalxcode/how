// Built-in answers that need no AI, so the page shows what it does before anyone signs in.
// Same shape as what the AI returns (see app.js).
const DEMO = {
  scissors: {
    title: 'Scissors',
    hook: 'Two levers sharing one hinge: a small squeeze of your fingers becomes a strong pinch between two sliding edges.',
    kind: 'object',
    wikipedia_title: 'Scissors',
    search_terms: 'scissors',
    lang: 'English',
    fun_fact: 'Scissor blades are not very sharp. They cut by shearing: two edges passing each other so closely that the paper has nowhere to go.',
    parts: [
      { id: 'p1', name: 'Top blade & handle', role: 'One lever: ring at the back, cutting edge at the front', color: '#1f8a8a' },
      { id: 'p2', name: 'Bottom blade & handle', role: 'The other lever, mirrored, crossing the first', color: '#2b4c7e' },
      { id: 'p3', name: 'Pivot screw', role: 'The hinge both levers turn around; it keeps the blades pressed together', color: '#e4572e' },
    ],
    steps: [
      { title: 'Squeeze', text: 'Your thumb and finger push the two rings towards each other.', parts: ['p1', 'p2'] },
      { title: 'Lever', text: 'Each half pivots on the screw. A small movement at the rings becomes a long, strong sweep at the blades.', parts: ['p3'] },
      { title: 'Shear', text: 'The two edges slide past each other, pinching the paper from both sides until it splits.', parts: ['p1', 'p2'] },
      { title: 'Moving cut', text: 'The crossing point travels along the blades, so the cut runs forward as you close them.', parts: ['p1', 'p2', 'p3'] },
    ],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520">
<rect width="800" height="520" fill="#fbf4e4"/>
<g id="fx">
  <rect x="455" y="110" width="310" height="300" rx="6" fill="#ffffff" stroke="#1d2433" stroke-width="3"/>
  <line x1="490" y1="150" x2="730" y2="150" stroke="#d9cdb2" stroke-width="3"/>
  <line x1="490" y1="190" x2="730" y2="190" stroke="#d9cdb2" stroke-width="3"/>
  <line x1="490" y1="330" x2="730" y2="330" stroke="#d9cdb2" stroke-width="3"/>
  <line x1="490" y1="370" x2="730" y2="370" stroke="#d9cdb2" stroke-width="3"/>
  <path d="M455 260 L700 260" fill="none" stroke="#1d2433" stroke-width="4" stroke-dasharray="245" stroke-dashoffset="245" stroke-linecap="round">
    <animate attributeName="stroke-dashoffset" values="245;245;60;60;245" keyTimes="0;0.1;0.5;0.95;1" dur="2.6s" repeatCount="indefinite"/>
  </path>
  <path d="M300 440 l-30 0 m0 0 l10 -8 m-10 8 l10 8" fill="none" stroke="#e4572e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <animate attributeName="opacity" values="1;0.2;1" dur="2.6s" repeatCount="indefinite"/>
  </path>
</g>
<g id="p2" data-explode="-60 170">
  <g transform="translate(400 260)">
    <animateTransform attributeName="transform" type="rotate" additive="sum" values="13;0;0;13" keyTimes="0;0.5;0.95;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1"/>
    <path d="M -6 14 L 316 82 L 330 72 L 300 58 L 24 -12 Z" fill="#2b4c7e" stroke="#1d2433" stroke-width="4" stroke-linejoin="round"/>
    <path d="M -14 -8 Q -95 -25 -178 -70" fill="none" stroke="#1d2433" stroke-width="28" stroke-linecap="round"/>
    <path d="M -14 -8 Q -95 -25 -178 -70" fill="none" stroke="#2b4c7e" stroke-width="20" stroke-linecap="round"/>
    <circle cx="-212" cy="-98" r="40" fill="none" stroke="#1d2433" stroke-width="24"/>
    <circle cx="-212" cy="-98" r="40" fill="none" stroke="#2b4c7e" stroke-width="16"/>
  </g>
</g>
<g id="p1" data-explode="-60 -170">
  <g transform="translate(400 260)">
    <animateTransform attributeName="transform" type="rotate" additive="sum" values="-13;0;0;-13" keyTimes="0;0.5;0.95;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1"/>
    <path d="M -6 -14 L 316 -82 L 330 -72 L 300 -58 L 24 12 Z" fill="#1f8a8a" stroke="#1d2433" stroke-width="4" stroke-linejoin="round"/>
    <path d="M -14 8 Q -95 25 -178 70" fill="none" stroke="#1d2433" stroke-width="28" stroke-linecap="round"/>
    <path d="M -14 8 Q -95 25 -178 70" fill="none" stroke="#1f8a8a" stroke-width="20" stroke-linecap="round"/>
    <circle cx="-212" cy="98" r="40" fill="none" stroke="#1d2433" stroke-width="24"/>
    <circle cx="-212" cy="98" r="40" fill="none" stroke="#1f8a8a" stroke-width="16"/>
  </g>
</g>
<g id="p3" data-explode="0 0">
  <circle cx="400" cy="260" r="17" fill="#e4572e" stroke="#1d2433" stroke-width="4"/>
  <line x1="391" y1="260" x2="409" y2="260" stroke="#1d2433" stroke-width="4" stroke-linecap="round"/>
</g>
</svg>`,
  },
};
