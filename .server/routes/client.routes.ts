import express from "express";
import {
  createClient,
  getAllClients,
  checkClient,
} from "../controllers/client.controller";

const router = express.Router();

// Создать клиента
router.post("/", createClient);

// Получить всех клиентов
router.get("/", getAllClients);

// Проверить клиента по ФИО
router.post("/check", checkClient);

export default router;
