// Простейший список нежелательных слов (расширяемый)
const BAD_WORDS = [
  'мат', 'плохое', 'спам', 'тест123', 'asdf', 'qwerty'
];

exports.containsProfanity = (text) => {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase().replace(/\s/g, '');
  return BAD_WORDS.some(word => lower.includes(word.toLowerCase()));
};
