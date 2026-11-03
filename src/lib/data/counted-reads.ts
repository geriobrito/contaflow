import {
  getCountFromServer as firestoreCount,
  getDoc as firestoreGetDoc,
  getDocs as firestoreGetDocs,
  type AggregateField,
  type AggregateQuerySnapshot,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { addReads, countReads, queryReads } from '@/lib/data/read-meter';

/*
 * Mesmas funções de leitura do Firestore, somando o que cada uma custa na cota diária
 * (ver read-meter.ts). Respostas vindas do cache local não são cobradas e não entram.
 */

export async function getDocs<A, D extends DocumentData>(query: Query<A, D>): Promise<QuerySnapshot<A, D>> {
  const snap = await firestoreGetDocs(query);
  if (!snap.metadata.fromCache) addReads(queryReads(snap.size));
  return snap;
}

export async function getDoc<A, D extends DocumentData>(ref: DocumentReference<A, D>): Promise<DocumentSnapshot<A, D>> {
  const snap = await firestoreGetDoc(ref);
  if (!snap.metadata.fromCache) addReads(1);
  return snap;
}

export async function getCountFromServer<A, D extends DocumentData>(
  query: Query<A, D>
): Promise<AggregateQuerySnapshot<{ count: AggregateField<number> }, A, D>> {
  const snap = await firestoreCount(query);
  addReads(countReads(snap.data().count));
  return snap;
}
