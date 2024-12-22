import express from "express";
import { getAllBanks } from "../controllers/bank.controller";

const router = express.Router();

// Получить список банков
router.get("/", getAllBanks);

export default router;
