export const MEMORY_ITEMS = ['TRIANGLE', 'CIRCLE', 'STAR', 'SQUARE', 'DIAMOND', 'CROSS'];
export const SYMBOLS = { TRIANGLE: '△', CIRCLE: '●', STAR: '★', SQUARE: '■', DIAMOND: '◆', CROSS: '✚' };
export const randomInt = (min, max, rng = Math.random) => min + Math.floor(rng() * (max - min + 1));
export function shuffle(values, rng = Math.random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i, rng);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function generateQuestion(rng = Math.random) {
  const category = randomInt(0, 3, rng);
  const a = randomInt(2, 6, rng), b = randomInt(1, 9, rng), n = randomInt(3, 6, rng);
  let prompt, correct, wrong, explanation, rule;
  if (category === 0) {
    rule = 'Chain rule: differentiate the outer function, then multiply by the derivative of the inner function.';
    prompt = `Find f'(x): f(x) = (${a}x + ${b})^${n}`;
    correct = `${a*n}(${a}x + ${b})^${n-1}`;
    wrong = [`${n}(${a}x + ${b})^${n-1}`, `${a*n}(${a}x + ${b})^${n}`];
    explanation = 'Multiply the outer power by the inner derivative and reduce the power by one.';
  } else if (category === 1) {
    rule = 'Substitution: set u = x² + b, so du = 2x dx. Integrate u to the given power.';
    prompt = `Evaluate ∫ 2x(x² + ${b})^${n} dx.`;
    correct = `(x² + ${b})^${n+1} / ${n+1} + C`;
    wrong = [`(x² + ${b})^${n} / ${n} + C`, `2(x² + ${b})^${n+1} + C`];
    explanation = 'Substitute u = x² + b, increase the power by one, and divide by the new power.';
  } else if (category === 2) {
    rule = 'Factor the difference of squares and cancel the common factor before evaluating the limit.';
    prompt = `Evaluate lim x→${a} (x² − ${a*a}) / (x − ${a}).`;
    correct = String(2*a); wrong = [String(a), String(2*a+1)];
    explanation = `The expression simplifies to x + ${a}; the limit is ${2*a}.`;
  } else {
    rule = 'Power rule: d(ax^n)/dx = an x^(n−1). The derivative of a constant is zero.';
    prompt = `Find f'(x): f(x) = ${a}x^${n} + ${b}x.`;
    correct = `${a*n}x^${n-1} + ${b}`;
    wrong = [`${a}x^${n-1} + ${b}`, `${a*n}x^${n} + ${b}`];
    explanation = 'Apply the power rule to each term.';
  }
  const choices = shuffle([correct, ...wrong], rng);
  return { id: 'CALCULUS', category, parameters: {a,b,n}, rule, prompt,
    options: choices.map((value,i) => ({id: 'ABC'[i], value})),
    correctId: 'ABC'[choices.indexOf(correct)], explanation };
}
export function generatePuzzles(rng = Math.random) {
  const memorySequence = shuffle(MEMORY_ITEMS, rng).slice(0, 5);
  const wrong1 = [...memorySequence]; [wrong1[0], wrong1[1]] = [wrong1[1], wrong1[0]];
  const wrong2 = [...memorySequence]; [wrong2[3], wrong2[4]] = [wrong2[4], wrong2[3]];
  const memoryOptions = shuffle([memorySequence, wrong1, wrong2], rng);
  return { doorCode: String(randomInt(1000,9999,rng)),
    // Use three distinct panels so every required answer is visible in the
    // demo recording; repeated colours made one press look like it vanished.
    lightSequence: shuffle([1, 2, 3], rng),
    spatialLightSequence: shuffle([1,2,3,4], rng),
    memorySequence, memoryOptions, memoryAnswer: memoryOptions.indexOf(memorySequence),
    correctPath: ['LEFT','CENTER','RIGHT'][randomInt(0,2,rng)], question: generateQuestion(rng) };
}
