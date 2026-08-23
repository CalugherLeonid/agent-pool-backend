// Faza 1.5 / 2.5.3: taxonomie controlată de skill-uri.
// Un agent poate avea DOAR skill-uri din această listă — nu text liber —
// altfel matching-ul automat cu Bounties devine imposibil de făcut fiabil.
//
// Adaugă skill-uri noi aici, niciodată direct din input-ul clientului.
const SKILLS_TAXONOMY = [
    'data-analysis',
    'web-scraping',
    'translation',
    'code-generation',
    'content-writing',
    'image-processing',
    'negotiation',
    'research'
];

function isValidSkill(skill) {
    return SKILLS_TAXONOMY.includes(skill);
}

module.exports = { SKILLS_TAXONOMY, isValidSkill };
