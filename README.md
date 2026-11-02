# Luma

Ứng dụng Windows 11 để quản lý khởi động, tinh chỉnh hệ thống và dọn file rác. Giao diện hỗ trợ tiếng Việt và tiếng Anh.

## Tính năng

- Tổng quan dung lượng ổ đĩa; giao diện sidebar xanh rừng.
- Bật/tắt ứng dụng khởi động, quản lý ngoại lệ và xem trước thay đổi.
- Hồ sơ tinh chỉnh, lịch sử, hoàn tác cấu hình và thử lại tác vụ lỗi.
- Dọn file tạm và báo cáo lỗi Windows trên 7 ngày: quét, chọn nhóm, xem trước, xác nhận và báo kết quả.
- Hiển thị trạng thái loading khi tác vụ chạy.

Disk Cleanup chỉ xử lý `%LOCALAPPDATA%\Temp` và `%LOCALAPPDATA%\Microsoft\Windows\WER\ReportArchive`. Bỏ qua file mới, file thay đổi, hard link, junction/symlink và thư mục dự án được nhận diện. Không dọn Downloads hay tài liệu cá nhân. File đã xóa **không thể hoàn tác**; nút hoàn tác chỉ áp dụng cho cấu hình. Kết quả dọn được giữ trong phiên hiện tại.

## Phát triển trên Windows

Cần Node.js 22+, npm và Windows PowerShell.

```powershell
npm ci
npm run dev
```

```powershell
npm run typecheck
npm test
npm run check
npm run test:ui
npm run release
```

Bộ cài nằm trong `release-luma/`. Bộ kiểm thử cleanup chỉ xóa file fixture do nó tạo trong `.qa/`; UI test sử dụng dữ liệu giả lập. Bộ cài hiện chưa ký số.

## Thiết kế và giới hạn

- [Đặc tả 0.2](docs/SPEC-0.2.md)
- [Mockup đã duyệt](design/luma-v2/prototype.png)
- [Changelog](CHANGELOG.md)
- [Tình trạng dependency](docs/DEPENDENCY-AUDIT.md)

Dữ liệu cấu hình tiếp tục dùng thư mục ứng dụng `Trim` để giữ lịch sử cũ. Không nâng quyền cho tính năng dọn file. Quét bị giới hạn thời gian/số mục; giao diện báo khi kết quả chưa đầy đủ. Các kiểm tra đường dẫn không bảo đảm chống tiến trình cục bộ độc hại thay đổi filesystem đồng thời.
