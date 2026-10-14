// Configuración del backend real (proyecto Firebase de BrasPer). La clave web es pública pero se lee del entorno, no del código.
function configBackend(env) {
  if (!env.FIREBASE_API_KEY) throw new Error('falta FIREBASE_API_KEY en .env (la clave web pública de Firebase) para BACKEND=real');
  const projectId = env.FIREBASE_PROJECT_ID || 'aibrasper';
  return {
    apiKey: env.FIREBASE_API_KEY,
    projectId,
    bucket: env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    identityUrl: env.FIREBASE_IDENTITY_URL || 'https://identitytoolkit.googleapis.com',
    tokenUrl: env.FIREBASE_TOKEN_URL || 'https://securetoken.googleapis.com',
    // Las funciones callable se sirven en https://<nombre-en-minúsculas>-<hash>.a.run.app
    functionsUrl: env.FIREBASE_FUNCTIONS_URL || 'https://{nombre}-h5wenirx2q-rj.a.run.app',
    firestoreUrl: env.FIREBASE_FIRESTORE_URL || `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`,
    storageUrl: env.FIREBASE_STORAGE_URL || 'https://firebasestorage.googleapis.com',
  };
}

module.exports = { configBackend };
