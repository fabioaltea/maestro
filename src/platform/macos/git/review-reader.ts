import type {GitIntegrationPort} from '../../../ports/review.js';

export function createReviewGitReader(port:GitIntegrationPort){
 return{captureDiff:port.captureDiff.bind(port)};
}
