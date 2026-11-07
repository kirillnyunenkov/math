/* Historical task numbering and answers are independent of the current bank. */
window.ARCHIVE_EXAMS = Object.fromEntries([
  [2023, '01.06.2023 · Основная волна', ['10.5','27','0.4','0.992','-9','11','4','420','15','5','4']],
  [2024, '31.05.2024 · Основная волна', ['44','2.9','63','0.15','0.0064','8','2.5','2','7','56','168','9.1']]
].map(([year, subtitle, answers]) => {
  const scores = [2,3,2,2,3,4,4];
  const longAnswers = {
    2023: ['а) x = πk или x = ±5π/6 + 2πk, k ∈ ℤ; б) π, 7π/6, 11π/6, 2π', 'б) 5√5', '[−1; 2) ∪ (2; +∞)', '30%', 'б) 1:2', '[0; 6] ∪ {3 − 3√2; 3 + 3√2}', 'а) да; б) нет; в) 5/7'],
    2024: ['а) x = πn, 5π/4 + 2πn, 7π/4 + 2πn, n ∈ ℤ; б) 7π/4, 2π, 3π', 'б) 1:4', '{1/3} ∪ (2/3; +∞)', '122000', 'б) 17/3', '(3/4; 1) ∪ (1; 5/4)', 'а) да; б) нет; в) 3']
  };
  const items = [...answers.map((answer,i) => ({n:i+1,max:1,long:false,answer})),
    ...scores.map((max,i) => ({n:answers.length+i+1,max,long:true,answer:longAnswers[year][i]}))];
  for (const item of items) item.images = [`img/archive/${year}/${String(item.n).padStart(2,'0')}.png`];
  return [year, {subtitle, items}];
}));
