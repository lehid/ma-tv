// Libellés français partagés entre les scripts Node et le site.
export const CATEGORY_FR = {
  auto: 'Auto', animation: 'Animation', business: 'Économie', classic: 'Classiques', comedy: 'Humour',
  cooking: 'Cuisine', culture: 'Culture', documentary: 'Documentaires', education: 'Éducation',
  entertainment: 'Divertissement', family: 'Famille', general: 'Généraliste', interactive: 'Interactif',
  kids: 'Jeunesse', legislative: 'Parlement', lifestyle: 'Art de vivre', movies: 'Films', music: 'Musique',
  news: 'Info', outdoor: 'Plein air', public: 'Service public', relax: 'Détente', religious: 'Religion',
  series: 'Séries', science: 'Sciences', shop: 'Téléachat', sports: 'Sport', travel: 'Voyage',
  weather: 'Météo', xxx: 'Adulte',
};

export const FAVORITES_GROUP = '⭐ Favoris';
export const NSFW_GROUP = '🔞 Adulte';

export const categoryLabel = (id) => CATEGORY_FR[id] || id;

/** Groupe M3U / section d'affichage d'une entrée. */
export function groupOf(entry, favorites) {
  if (entry.nsfw) return NSFW_GROUP;
  if (favorites?.has(entry.channel)) return FAVORITES_GROUP;
  return categoryLabel(entry.categories[0]);
}
