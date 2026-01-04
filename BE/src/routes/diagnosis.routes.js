const express = require('express');
const router = express.Router();
const diagnosisController = require('../controllers/diagnosis.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const uploadCloud = require('../config/cloudinary');

/**
 * @swagger
 * /api/diagnose:
 *   post:
 *     summary: Chẩn đoán bệnh da qua hình ảnh
 *     tags: [Diagnosis]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Hình ảnh da cần chẩn đoán
 *     responses:
 *       200:
 *         description: Chẩn đoán thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 disease_name:
 *                   type: string
 *                   example: "Bệnh Vẩy Nến (Psoriasis)"
 *                 confidence_score:
 *                   type: number
 *                   format: float
 *                   example: 0.92
 *                 description:
 *                   type: string
 *                   example: "Đây là mô tả về bệnh..."
 *                 recommendation:
 *                   type: string
 *                   example: "Bạn nên đi khám bác sĩ da liễu."
 *                 image_url:
 *                   type: string
 *                   format: uri
 *                   description: URL của hình ảnh đã upload
 *       400:
 *         description: Không có file ảnh
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Không có quyền truy cập
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Lỗi máy chủ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
    '/',
    authMiddleware,    // 1. Kiểm tra token
    uploadCloud.single('image'),  // 2. Xử lý file upload
    diagnosisController.diagnose // 3. Xử lý logic
);

/**
 * @swagger
 * /api/diagnose/history:
 *   get:
 *     summary: Lấy lịch sử chẩn đoán của người dùng
 *     tags: [Diagnosis]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Danh sách lịch sử chẩn đoán
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   diagnosis_id:
 *                     type: integer
 *                   user_id:
 *                     type: integer
 *                   image_url:
 *                     type: string
 *                     format: uri
 *                   disease_name:
 *                     type: string
 *                   confidence_score:
 *                     type: number
 *                     format: float
 *                   result_json:
 *                     type: object
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Không có quyền truy cập
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Lỗi máy chủ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/history', authMiddleware, diagnosisController.getHistory);
router.get('/code/:diseaseCode', authenticate, diseaseController.getDiseaseByCode);
/**
 * @swagger
 * /api/diagnose/{id}:
 *   delete:
 *     summary: Xóa một item trong lịch sử chẩn đoán
 *     tags: [Diagnosis]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID của chẩn đoán
 *     responses:
 *       200:
 *         description: Xóa thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Xóa lịch sử chẩn đoán thành công"
 *       401:
 *         description: Không có quyền truy cập
 *       404:
 *         description: Không tìm thấy chẩn đoán
 *       500:
 *         description: Lỗi máy chủ
 */
router.delete('/:id', authMiddleware, diagnosisController.deleteHistoryItem);



module.exports = router;
