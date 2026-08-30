const d = { id: 1, author: ["a","b"], translator: ["c"], title: "t" };
const creators = (Array.isArray(d.author) || []).concat(Array.isArray(d.translator) || []).filter(Boolean);
console.log("creators:", creators);
