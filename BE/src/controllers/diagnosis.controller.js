
const diagnosisModel = require('../models/diagnosis.model');
const { pool } = require('../config/db');

// Danh sách các bệnh nguy hiểm (để map risk level)
const CANCER_TYPES = ['Melanoma', 'Basal Cell Carcinoma', 'Squamous Cell Carcinoma'];

const diagnosisController = {
    diagnose: async (req, res) => {
        try {
            // 1. Kiểm tra ảnh upload
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Vui lòng upload ảnh.' });
            }

            // Lấy URL ảnh từ Cloudinary (Cloudinary middleware đã xử lý việc upload rồi)
            const imageUrl = req.file.secure_url || req.file.url;

            // 2. [QUAN TRỌNG] Nhận kết quả AI từ Mobile gửi lên (qua req.body)
            // Mobile gửi lên dạng String JSON, cần parse ra
            let aiResult = {};
            if (req.body.ai_result) {
                try {
                    aiResult = JSON.parse(req.body.ai_result);
                } catch (e) {
                    aiResult = req.body.ai_result; // Nếu đã là object
                }
            }

            const predictedClass = aiResult.class || 'Unknown_Normal';
            const confidence = parseFloat(aiResult.confidence || 0);
            // === [SỬA LẠI LOGIC TÍNH MỨC ĐỘ NGUY HIỂM] ===
            let riskLevel = 'low'; // Mặc định là thấp

            // 1. Danh sách các lớp AN TOÀN hoặc KHÔNG PHẢI BỆNH (Luôn là Low/None)
            const SAFE_CLASSES = ['Normal Skin', 'Nevus', 'Unknown_Normal'];

            // 2. Danh sách các bệnh UNG THƯ/NGUY HIỂM (Luôn là High)
            const DANGEROUS_CLASSES = ['Melanoma', 'Basal Cell Carcinoma', 'Squamous Cell Carcinoma'];

            if (SAFE_CLASSES.includes(predictedClass)) {
                // Nếu là da thường, nốt ruồi hoặc ảnh rác -> Luôn an toàn
                riskLevel = 'low';
                if (predictedClass === 'Normal Skin') riskLevel = 'none'; // Da khỏe hẳn
            } else if (DANGEROUS_CLASSES.includes(predictedClass)) {
                // Nếu là ung thư -> Luôn nguy hiểm
                riskLevel = 'high';
            } else {
                // Các bệnh còn lại (Nấm, Dày sừng...): Dựa vào độ tin cậy
                if (confidence >= 0.80) {
                    riskLevel = 'moderate'; // Bệnh da liễu thông thường nhưng rõ ràng -> Cần theo dõi
                } else {
                    riskLevel = 'low';
                }
            }



            // 4. Lấy thông tin bệnh tiếng Việt từ DB
            let diseaseInfo = null;
            let diseaseNameVi = "Chưa cập nhật";
            let infoId = null;
            let description = "";

            // Xử lý cứng cho trường hợp Unknown và Normal để không cần query DB
            if (predictedClass === 'Unknown_Normal') {
                diseaseNameVi = "Không xác định / Ảnh không liên quan";
                description = "Hệ thống không nhận diện được vùng da bệnh lý trong ảnh này. Có thể do ảnh mờ, thiếu sáng hoặc không phải ảnh da.";
            } else if (predictedClass === 'Normal Skin') {
                diseaseNameVi = "Da bình thường";
                description = "Không phát hiện dấu hiệu bất thường trên vùng da này.";
            } else {
                // Chỉ query DB nếu là bệnh thật sự
                try {
                    const [rows] = await pool.query(
                        'SELECT info_id, disease_name_vi, description FROM skin_diseases_info WHERE disease_code = ?',
                        [predictedClass]
                    );
                    if (rows.length > 0) {
                        diseaseInfo = rows[0];
                        diseaseNameVi = diseaseInfo.disease_name_vi;
                        infoId = diseaseInfo.info_id;
                        description = diseaseInfo.description;
                    }
                } catch (dbError) {
                    console.error('Database Query Error:', dbError);
                }
            }

            // 5. Chuẩn bị dữ liệu để lưu và trả về
            const finalResult = {
                success: true,
                image_url: imageUrl,
                disease_name: predictedClass,
                disease_name_vi: diseaseNameVi,
                info_id: infoId,
                confidence_score: confidence,
                description: description,
                risk_level: riskLevel,
                recommendation: "Kết quả mang tính tham khảo. Vui lòng gặp bác sĩ.",
                // Các trường phụ trợ cho App hiển thị
                prediction_code: predictedClass,
                confidence_percent: `${(confidence * 100).toFixed(2)}%`
            };

            // 6. Lưu vào Database (Lúc này mới lưu)
            await diagnosisModel.create(
                req.user.userId,
                imageUrl,
                predictedClass,
                confidence,
                finalResult
            );

            console.log(`✅ Đã lưu kết quả cho user ${req.user.userId}: ${predictedClass}`);

            // Trả về cho App
            return res.status(200).json(finalResult);

        } catch (error) {
            console.error("❌ Controller Error:", error);
            res.status(500).json({ success: false, message: 'Lỗi xử lý server' });
        }
    },

    /**
     * GET /api/diagnose/history
     * Get diagnosis history for current user
     */
    getHistory: async (req, res) => {
        try {
            const userId = req.user.userId;
            const history = await diagnosisModel.findByUserId(userId);

            res.status(200).json({
                success: true,
                count: history.length,
                data: history
            });
        } catch (error) {
            console.error('Get History Error:', error);
            res.status(500).json({
                success: false,
                message: 'Lỗi máy chủ',
                error: error.message
            });
        }
    },

    /**
     * DELETE /api/diagnose/:id
     * Delete a diagnosis history item
     */
    deleteHistoryItem: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.userId;

            const success = await diagnosisModel.deleteById(id, userId);

            if (success) {
                res.status(200).json({
                    success: true,
                    message: 'Đã xóa kết quả chẩn đoán.'
                });
            } else {
                res.status(404).json({
                    success: false,
                    message: 'Không tìm thấy bản ghi hoặc bạn không có quyền xóa.'
                });
            }
        } catch (error) {
            console.error('Delete Error:', error);
            res.status(500).json({
                success: false,
                message: 'Lỗi máy chủ',
                error: error.message
            });
        }
    }
};

module.exports = diagnosisController;