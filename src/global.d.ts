/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    __vidscribeAcceptanceTrace: {
      reviewLengths: number[];
      sawPreparingWithoutReview: boolean;
      sawTranscribingWithoutReview: boolean;
    };
  }
}
