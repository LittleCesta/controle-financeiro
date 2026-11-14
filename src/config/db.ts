import dns from "node:dns";
import { MongoClient, ObjectId } from "mongodb";
import type {
  Expense,
  Group,
  Outing,
  Payment,
  Person,
  User,
} from "../domain/finance";
import { ENVIRONMENT } from "./environment";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

// Estado do bot: qual grupo está ativo e qual nome é "eu" (padrão de quem pagou)
export interface BotState {
  _id: number;
  groupId?: ObjectId;
  meName?: string;
}

export const client = new MongoClient(
  ENVIRONMENT.mongo.mongoUrl ?? "mongodb://localhost:27017",
  {
    serverSelectionTimeoutMS: 5000,
  },
);
const db = client.db("divisao_gastos");

export const users = db.collection<User>("users");
export const groups = db.collection<Group>("groups");
export const people = db.collection<Person>("people");
export const outings = db.collection<Outing>("outings");
export const expenses = db.collection<Expense>("expenses");
export const payments = db.collection<Payment>("payments");
export const botState = db.collection<BotState>("bot_state");
