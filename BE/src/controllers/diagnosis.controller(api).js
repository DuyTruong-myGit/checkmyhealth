const diagnosisModel = require('../models/diagnosis.model');
const axios = require('axios');
const { pool } = require('../config/db');

// ===== AI TO DATABASE MAPPING =====
// Key: Khớp 100% với output từ AI API (có space, Title Case)
// Value: disease_code trong MySQL database
const AI_TO_DB_MAP = {
    'Actinic Keratosis': 'Actinic Keratosis',
    'Basal Cell Carcinoma': 'Basal Cell Carcinoma',
    'Dermato Fibroma': 'Dermato Fibroma',
    'Melanoma': 'Melanoma',
    'Nevus': 'Nevus',
    'Normal Skin': 'Normal Skin',
    'Pigmented Benign Keratosis': 'Pigmented Benign Keratosis',
    'Ringworm': 'Ringworm',
    'Seborrheic Keratosis': 'Seborrheic Keratosis',
    'Squamous Cell Carcinoma': 'Squamous Cell Carcinoma',
    'Unknown_Normal': 'Unknown_Normal',
    'Vascular Lesion': 'Vascular Lesion'
};

// ===== VALIDATE SKIN IMAGE =====
const validateSkinImage = (predictedClass, confidence) => {
    // Case 1: Unknown/Invalid image
    if (predictedClass === 'Unknown_Normal') {
        return {
            isValid: false,
            reason: 'not_skin_image',
            message: 'Hình ảnh không rõ ràng hoặc không phải là vùng da. Vui lòng chụp lại.'
        };
    }

    // Case 2: Normal healthy skin
    if (predictedClass === 'Normal Skin') {
        return {
            isValid: true,
            isDisease: false,
            message: 'Da khỏe mạnh, không phát hiện dấu hiệu bất thường.'
        };
    }

    // Case 3: Disease not in mapping
    if (!AI_TO_DB_MAP[predictedClass]) {
        console.warn(`[AI Warning] Unmapped class detected: ${predictedClass}`);
        return {
            isValid: false,
            reason: 'unsupported_disease',
            message: 'Hệ thống phát hiện loại bệnh mới chưa được cập nhật dữ liệu.'
        };
    }

    // Case 4: Low confidence score
    if (confidence < 0.5) {
        return {
            isValid: false,
            reason: 'low_confidence',
            message: 'Độ tin cậy thấp. Vui lòng chụp ảnh rõ nét hơn với ánh sáng tốt.'
        };
    }

    return { isValid: true, isDisease: true };
};

// ===== CALL AI API =====
const callAiApiReal = async (imageUrl) => {
    const startTime = Date.now();
    
    try {
        console.log(`[1] 📥 Đang tải ảnh từ Cloudinary: ${imageUrl}`);
        
        // Step 1: Download image from Cloudinary as buffer
        const imageResponse = await axios.get(imageUrl, { 
            responseType: 'arraybuffer',
            timeout: 15000 
        });
        
        const buffer = Buffer.from(imageResponse.data);
        const base64Image = buffer.toString('base64');
        
        console.log(`[2] 📤 Đang gửi ảnh tới AI API (${buffer.length} bytes)`);
        
        // Step 2: Call AI API with correct format
        const aiResponse = await axios.post('https://train-ai-exam.fly.dev/predict', {
            image: base64Image
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 90000, // 90 seconds for cold start
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log('[3] ✅ AI API đã phản hồi thành công!');
        
        const responseTime = Date.now() - startTime;
        const aiResult = aiResponse.data;
        
        // Step 3: Validate AI response structure
        if (!aiResult || aiResult.status !== 'success') {
            console.error('[AI Error] Invalid response structure:', aiResult);
            throw new Error('AI API returned invalid response structure');
        }
        
        // Step 4: Extract prediction data
        const predictedClass = aiResult.prediction.class;
        const confidence = aiResult.prediction.confidence;
        const confidencePercent = aiResult.prediction.confidence_percent;
        
        console.log(`[4] 🔍 Prediction: ${predictedClass} (${confidencePercent})`);
        
        // Step 5: Validate prediction
        const validation = validateSkinImage(predictedClass, confidence);
        
        if (!validation.isValid) {
            return {
                success: false,
                error_type: validation.reason,
                description: validation.message,
                is_valid_skin_image: false
            };
        }

        // Step 6: Map to database disease code
        const dbDiseaseCode = AI_TO_DB_MAP[predictedClass];
        
        let diseaseInfo = null;
        let diseaseNameVi = "Chưa cập nhật tiếng Việt";
        let infoId = null;

        // Step 7: Query database for disease info (only if it's a disease)
        if (validation.isDisease) {
            try {
                const [rows] = await pool.query(
                    'SELECT info_id, disease_name_vi, description FROM skin_diseases_info WHERE disease_code = ?', 
                    [dbDiseaseCode]
                );
                
                if (rows.length > 0) {
                    diseaseInfo = rows[0];
                    diseaseNameVi = diseaseInfo.disease_name_vi;
                    infoId = diseaseInfo.info_id;
                    console.log(`[5] 📚 Found disease info in DB: ${diseaseNameVi}`);
                } else {
                    console.warn(`[5] ⚠️  Disease code not found in DB: ${dbDiseaseCode}`);
                }
            } catch (dbError) {
                console.error('[5] ❌ Database query error:', dbError);
            }
        } else {
            diseaseNameVi = "Da khỏe mạnh";
            console.log('[5] ✅ Normal healthy skin detected');
        }

        // Step 8: Prepare response
        const description = diseaseInfo?.description || "";
        const top3 = aiResult.top3_predictions || [];
        
        // Determine risk level based on confidence and disease type
        let riskLevel = 'low';
        if (validation.isDisease) {
            if (confidence >= 0.85) riskLevel = 'high';
            else if (confidence >= 0.7) riskLevel = 'medium';
            
            // Cancer types should be high risk regardless of confidence
            const cancerTypes = ['Melanoma', 'Basal Cell Carcinoma', 'Squamous Cell Carcinoma'];
            if (cancerTypes.includes(predictedClass)) {
                riskLevel = 'high';
            }
        }

        const result = {
            success: true,
            is_valid_skin_image: true,
            image_url: imageUrl,
            
            // Disease information
            disease_name: dbDiseaseCode || "Normal Skin",
            disease_name_vi: diseaseNameVi,
            info_id: infoId,
            
            // Prediction details
            confidence_score: confidence,
            confidence_percent: confidencePercent,
            description: description,
            recommendation: "Vui lòng tham khảo ý kiến bác sĩ chuyên khoa da liễu để được chẩn đoán chính xác.",
            risk_level: riskLevel,
            
            // Additional data
            prediction_code: predictedClass,
            top3_predictions: top3,
            all_probabilities: aiResult.all_probabilities || {},
            
            // Metadata
            response_time_ms: responseTime
        };

        console.log(`[6] ✅ Processing complete in ${responseTime}ms`);
        return result;

    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // Log detailed error information
        if (error.response) {
            console.error('[AI API Error]', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        } else if (error.request) {
            console.error('[AI Network Error] No response received:', error.message);
        } else {
            console.error('[AI Logic Error]:', error.message);
        }
        
        // Return user-friendly error
        return { 
            success: false, 
            error_type: 'processing_error', 
            description: 'Lỗi kết nối đến hệ thống AI. Vui lòng thử lại sau.',
            response_time_ms: responseTime
        };
    }
};

// ===== CONTROLLER =====
const diagnosisController = {
    /**
     * POST /api/diagnose
     * Diagnose skin disease from uploaded image
     */
    diagnose: async (req, res) => {
        try {
            // Validate file upload
            if (!req.file) {
                return res.status(400).json({ 
                    success: false,
                    message: 'Vui lòng upload ảnh.' 
                });
            }
            
            // Get image URL from Cloudinary
            const imageUrl = req.file.secure_url || req.file.url;
            
            console.log('='.repeat(60));
            console.log('🔬 NEW DIAGNOSIS REQUEST');
            console.log(`👤 User ID: ${req.user.userId}`);
            console.log(`🖼️  Image URL: ${imageUrl}`);
            console.log('='.repeat(60));
            
            // Call AI API
            const result = await callAiApiReal(imageUrl);

            // If failed (invalid image, low confidence, etc.)
            if (!result.success) {
                console.log('❌ Diagnosis failed:', result.error_type);
                return res.status(400).json(result);
            }

            // Save to database
            try {
                await diagnosisModel.create(
                    req.user.userId,
                    imageUrl, 
                    result.disease_name, 
                    result.confidence_score,
                    result // Save full result as JSON
                );
                console.log('💾 Saved to database successfully');
            } catch (dbError) {
                console.error('⚠️  Failed to save to database:', dbError);
                // Continue anyway, don't fail the request
            }

            console.log('✅ Diagnosis completed successfully');
            console.log('='.repeat(60));
            
            res.status(200).json(result);

        } catch (error) {
            console.error("❌ Diagnose Controller Error:", error);
            res.status(500).json({ 
                success: false,
                message: 'Lỗi máy chủ nội bộ', 
                error: error.message 
            });
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