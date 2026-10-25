// Built-in pages that need no AI, so the site shows what it does before anyone signs in.
// Same shape as what the AI returns (see app.js). The picture is a plain image file.
const DEMO = {
  scissors: {
    title: 'Scissors',
    hook: 'Two levers sharing one hinge: a small squeeze of your fingers becomes a strong pinch between two sliding edges.',
    kind: 'object',
    wikipedia_title: 'Scissors',
    search_terms: 'scissors',
    lang: 'English',
    image: 'demo-scissors.jpg',
    fun_fact: 'Scissor blades are not very sharp. They cut by shearing: two edges passing each other so closely that the paper has nowhere to go.',
    parts: [
      { id: 'p1', name: 'Top blade & handle', name_en: 'top blade and handle', role: 'One lever: ring at the back, cutting edge at the front' },
      { id: 'p2', name: 'Bottom blade & handle', name_en: 'bottom blade and handle', role: 'The other lever, mirrored, crossing the first' },
      { id: 'p3', name: 'Pivot screw', name_en: 'pivot screw', role: 'The hinge both levers turn around; it keeps the blades pressed together' },
    ],
    steps: [
      { title: 'Squeeze', text: 'Your thumb and finger push the two rings towards each other.' },
      { title: 'Lever', text: 'Each half pivots on the screw. A small movement at the rings becomes a long, strong sweep at the blades.' },
      { title: 'Shear', text: 'The two edges slide past each other, pinching the paper from both sides until it splits.' },
      { title: 'Moving cut', text: 'The crossing point travels along the blades, so the cut runs forward as you close them.' },
    ],
    image_prompt: 'A pair of ordinary household scissors, about 20 cm long, two steel blades with coloured plastic finger rings. Exploded view: the two halves separated along the pivot axis in their real order and real relative sizes, small gaps, thin grey leader lines, the small pivot screw between them. Every one of these parts is clearly visible and marked with a white circle containing a bold black number: 1 top blade and handle, 2 bottom blade and handle, 3 pivot screw. Number badges only. No other text, words or letters anywhere. Vintage children\'s encyclopedia illustration, flat bold colours, thick dark outlines, soft cream paper background, three-quarter view, evenly lit, the whole thing centred with margins, nothing cropped.',
  },
};
