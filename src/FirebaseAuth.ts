import {
  OutgoingMessage,
  type Extension,
  type onAuthenticatePayload,
  type onTokenSyncPayload,
} from '@hocuspocus/server';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { isClassNotesDocument, parseClassNotesDocument } from './ClassNotes.js';

type AuthContext = {
  userID: string;
  admin: boolean;
};

type AccessLevel = 'read-only' | 'read-write' | 'none';
type Permission = 'OWNER' | 'READ_WRITE' | 'READ' | 'PRIVATE' | null;

export const initializeFirebaseAdmin = () => {
  if (process.env.NODE_ENV === 'production') {
    return initializeApp({
      credential: cert(
        process.env.FIREBASE_CRED_PATH || './serviceAccountKey.json'
      ),
      databaseURL:
        process.env.FIREBASE_DB_URL ||
        'https://algopro-app-default-rtdb.europe-west1.firebasedatabase.app',
    });
  }
  return initializeApp({
    projectId: 'algopro-app',
    databaseURL: 'http://firebase:9000?ns=algopro-app-default-rtdb',
  });
};

export class FirebaseAuth implements Extension {
  readonly app: App;
  readonly tokenCache = new Map<string, DecodedIdToken>();

  constructor(app: App) {
    this.app = app;
  }

  private async verifyToken(token: string): Promise<DecodedIdToken> {
    const cached = this.tokenCache.get(token);

    if (cached && cached.exp * 1000 > Date.now() + 5000) {
      return cached;
    }

    let decoded: DecodedIdToken;
    if (process.env.NODE_ENV === 'production') {
      decoded = await getAuth(this.app).verifyIdToken(token);
    } else {
      const tok = (await import('jsonwebtoken')).decode(token);
      if (
        !tok ||
        typeof tok === 'string' ||
        typeof tok.sub !== 'string' ||
        !tok.sub
      ) {
        throw new Error('Invalid JSON Web Token');
      }

      // Raw Firebase JWTs store the UID in sub; the Admin SDK adds uid on verification.
      decoded = { ...tok, uid: tok.sub } as unknown as DecodedIdToken;
    }
    this.tokenCache.set(token, decoded);
    return decoded;
  }

  private async getAccess(
    auth: DecodedIdToken,
    documentName: string
  ): Promise<AccessLevel> {
    if (isClassNotesDocument(documentName)) {
      const { groupID, classID, creationTime } =
        parseClassNotesDocument(documentName);
      const firestore = getFirestore(this.app);
      const groupRef = firestore.collection('groups').doc(groupID);
      const [group, groupClass] = await Promise.all([
        groupRef.get(),
        groupRef.collection('classes').doc(classID).get(),
      ]);
      if (
        !group.exists ||
        !groupClass.exists ||
        group.get('deleting') === true ||
        groupClass.get('creationTime') !== creationTime
      ) {
        return 'none';
      }

      const schoolID = group.get('school');
      if (auth.admin === true) return 'read-write';
      if (
        typeof schoolID === 'string' &&
        Array.isArray(auth.teacher) &&
        auth.teacher.includes(schoolID)
      ) {
        return 'read-write';
      }

      const user = await firestore.collection('userdata').doc(auth.uid).get();
      const groups = user.get('groups');
      return Array.isArray(groups) && groups.includes(groupID)
        ? 'read-only'
        : 'none';
    }

    if (auth.admin === true) {
      return 'read-write';
    }

    if (!documentName.includes('.')) {
      return 'read-write';
    }

    const fileID = documentName.split('.')[0];

    const db = getDatabase(this.app);
    const [defaultPermissionSnapshot, userPermissionSnapshot] =
      await Promise.all([
        db.ref(`files/${fileID}/settings/defaultPermission`).get(),
        db.ref(`files/${fileID}/users/${auth.uid}/permission`).get(),
      ]);

    const defaultPermission =
      (defaultPermissionSnapshot.val() as Permission) ?? null;
    const userPermission = (userPermissionSnapshot.val() as Permission) ?? null;

    if (userPermission === 'OWNER' || userPermission === 'READ_WRITE') {
      return 'read-write';
    }

    if (userPermission === 'READ') {
      return 'read-only';
    }

    // Equivalent to: defaultPermission !== 'PRIVATE'
    if (defaultPermission !== 'PRIVATE') {
      if (defaultPermission === 'OWNER' || defaultPermission === 'READ_WRITE') {
        return 'read-write';
      }

      return 'read-only';
    }

    return 'none';
  }

  async onAuthenticate(data: onAuthenticatePayload) {
    try {
      const token = await this.verifyToken(data.token);

      if (token.registered !== true) {
        throw new Error('User is not registered');
      }

      const authContext = { userID: token.uid, admin: token.admin === true };

      const accessLevel = await this.getAccess(token, data.documentName);

      if (accessLevel === 'none') {
        throw new Error('User does not have access to this document');
      }

      data.connectionConfig.readOnly = accessLevel === 'read-only';

      console.log(
        `Authenticated user ${token.uid} (${token.email}) for ${data.documentName} with ${data.connectionConfig.readOnly ? 'read-only' : 'read-write'} access`
      );
      return authContext;
    } catch (error) {
      console.error('Authentication error:', error);
      throw new Error('Authentication failed');
    }
  }

  async onTokenSync(data: onTokenSyncPayload<AuthContext>) {
    try {
      const token = await this.verifyToken(data.token);

      if (token.registered !== true) {
        throw new Error('User is not registered');
      }

      if (token.uid !== data.context.userID) {
        throw new Error('Token user does not match authenticated user');
      }

      const accessLevel = await this.getAccess(token, data.documentName);

      if (accessLevel === 'none') {
        throw new Error('User does not have access to this document');
      }

      data.connectionConfig.readOnly = accessLevel === 'read-only';
      data.connection.readOnly = data.connectionConfig.readOnly;
      data.connection.send(
        new OutgoingMessage(data.connection.messageAddress)
          .writeAuthenticated(data.connection.readOnly)
          .toUint8Array()
      );

      console.log(
        `Token sync for ${token.uid} on ${data.documentName} with ${data.connectionConfig.readOnly ? 'read-only' : 'read-write'} access`
      );
    } catch (error) {
      console.error('Token sync auth error:', error);
      throw new Error('Token sync authentication failed');
    }
  }
}
