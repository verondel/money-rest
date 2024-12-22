import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const createClient = async (req: Request, res: Response) => {
  try {
    const { name, surname, middle_name, birth, phone, wallet } = req.body;

    const newUser = await prisma.client.create({
      data: {
        name,
        surname,
        middle_name,
        birth,
        phone,
        wallet,
      },
    });

    res.status(200).json({ message: "User added successfully!", data: newUser });
  } catch (error) {
    console.error("Error creating client:", error);
    res.status(500).json({ message: "Failed to create user.", error });
  }
};

export const getAllClients = async (_req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany();
    res.json(clients);
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ message: "Failed to fetch clients." });
  }
};

export const checkClient = async (req: Request, res: Response) => {
  try {
    const { name, surname, middle_name } = req.body;

    const user = await prisma.client.findFirst({
      where: { name: name.trim(), surname: surname.trim(), middle_name: middle_name.trim() },
    });

    if (!user) return res.json({ exists: false });

    const transactions = await prisma.transaction.findMany({
      where: { clientId: user.id },
      select: { id: true, date: true, amount: true },
      orderBy: { date: "desc" },
    });

    res.json({
      exists: true,
      user,
      transactions: transactions.length > 0 ? transactions : [],
    });
  } catch (error) {
    console.error("Error checking client:", error);
    res.status(500).json({ message: "Server error. Try again later." });
  }
};
