import { ImageSourcePropType } from 'react-native';

interface PersonMapping {
    imageUrl: ImageSourcePropType;
    personName: string;
}

// Tableau de correspondance entre URL d'image et nom de personne
const personMappings: PersonMapping[] = [
    { imageUrl: require('../assets/images/gt/bachelot.png'), personName: 'roselyne bachelot' },
    { imageUrl: require('../assets/images/gt/barbier.png'), personName: 'christophe barbier' },
    { imageUrl: require('../assets/images/gt/beaugrand.png'), personName: 'christophe beaugrand' },
    { imageUrl: require('../assets/images/gt/bernier.png'), personName: 'michèle bernier' },
    { imageUrl: require('../assets/images/gt/boulay.png'), personName: 'steevy boulay' },
    { imageUrl: require('../assets/images/gt/bravo.png'), personName: 'christine bravo' },
    { imageUrl: require('../assets/images/gt/bugsy.png'), personName: 'stomy bugsy' },
    { imageUrl: require('../assets/images/gt/constance.png'), personName: 'constance' },
    { imageUrl: require('../assets/images/gt/diament.png'), personName: 'caroline diament' },
    { imageUrl: require('../assets/images/gt/el-kharrat.png'), personName: 'paul el-kharrat' },
    { imageUrl: require('../assets/images/gt/ferrari.png'), personName: 'jérémy ferrari' },
    { imageUrl: require('../assets/images/gt/foly.png'), personName: 'liane foly' },
    { imageUrl: require('../assets/images/gt/giesbert.png'), personName: 'olivier giesbert' },
    { imageUrl: require('../assets/images/gt/janssens.png'), personName: 'jeanfi janssens' },
    { imageUrl: require('../assets/images/gt/kersauson.png'), personName: 'olivier de kersauson' },
    { imageUrl: require('../assets/images/gt/ladesou.png'), personName: 'chantal ladesou' },
    { imageUrl: require('../assets/images/gt/leclerc.png'), personName: 'julie leclerc' },
    { imageUrl: require('../assets/images/gt/mabille.png'), personName: 'bernard mabille' },
    { imageUrl: require('../assets/images/gt/mairesse.png'), personName: 'valérie mairesse' },
    { imageUrl: require('../assets/images/gt/mergault.png'), personName: 'isabelle mergault' },
    { imageUrl: require('../assets/images/gt/riou.png'), personName: 'yoann riou' },
    { imageUrl: require('../assets/images/gt/trierweiler.png'), personName: 'valérie trierweiler' },
];

/**
 * Recherche les noms de personnes dans la description d'un épisode et retourne l'URL de l'image correspondante.
 * Si plusieurs noms correspondent, une URL est choisie aléatoirement parmi les correspondances.
 * @param episodeDescription La description de l'épisode.
 * @returns L'URL de l'image d'une personne correspondante, ou undefined si aucune correspondance n'est trouvée.
 */
export const getImageUrlFromDescription = (episodeDescription: string): ImageSourcePropType | undefined => {
    const matchedImageUrls: ImageSourcePropType[] = [];
    const lowerCaseDescription = episodeDescription.toLowerCase();

    for (const mapping of personMappings) {
        if (lowerCaseDescription.includes(mapping.personName.toLowerCase())) {
            matchedImageUrls.push(mapping.imageUrl);
        }
    }

    if (matchedImageUrls.length === 0) {
        return require('../assets/images/gt/ruquier.png');
    }

    if (matchedImageUrls.length === 1) {
        return matchedImageUrls[0];
    }

    // Plusieurs correspondances, en choisir une aléatoirement
    const randomIndex = Math.floor(Math.random() * matchedImageUrls.length);
    return matchedImageUrls[randomIndex];
};

// Exemple d'utilisation (peut être retiré ou commenté)
// const description1 = "Un épisode avec Bob l'éponge et son ami Patrick Étoile.";
// console.log(getImageUrlFromDescription(description1));
