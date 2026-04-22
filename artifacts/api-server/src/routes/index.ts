import { Router, type IRouter } from "express";
import healthRouter from "./health";
import waRouter from "./wa";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/wa", waRouter);

export default router;
