import client from './client'

export const evaluationApi = {
  evaluate: (trainerName: string, testInputs: unknown[], testLabels: unknown[], modelVersion?: string) =>
    client.post(`/evaluation/${trainerName}`, {
      test_inputs: testInputs,
      test_labels: testLabels,
      model_version: modelVersion,
    }).then(r => r.data),

  confusionMatrixPng: (_trainerName: string, _testInputs: unknown[], _testLabels: unknown[]) =>
    `/api/v1/evaluation/${_trainerName}/confusion-matrix.png`,  // direct URL for <img> src
}
