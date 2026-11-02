# Luma v2 — Prototype và Disk Cleanup

Status: approved and implemented in 0.2.0. Cleanup tests operate only on isolated .qa fixtures.

## Bản đồ khả năng

| Module | Trách nhiệm | Phụ thuộc |
|---|---|---|
| ui-prototype | Thiết kế lại sidebar, tổng quan, bố cục bảng, trạng thái loading/kết quả, màn Dọn ổ đĩa và luồng xác nhận | — |
| disk-cleanup | Quét các vị trí được cho phép, cung cấp kết quả xem trước, dọn các mục được chọn và báo kết quả thực tế | ui-prototype được duyệt |

Thứ tự: duyệt thiết kế → đặc tả Disk Cleanup → triển khai và kiểm tra trên thư mục thử nghiệm → tích hợp → đóng gói.

## Hướng thiết kế

- Giữ tên Luma, chuyển sidebar sang xanh rừng đậm, phần nội dung trắng ấm.
- Tổng quan tập trung vào dung lượng, việc cần làm và hai hồ sơ hiện có; bỏ khối slogan lớn.
- Điều hướng: Tổng quan, Dọn ổ đĩa, Khởi động, Tinh chỉnh, Ứng dụng, Ngoại lệ, Lịch sử.
- Bảng căn cố định cột trạng thái/risk/nút thao tác, hỗ trợ bàn phím, hiển thị tốt từ 860 px.
- Loading dùng spinner và thanh trạng thái; giữ nội dung rõ nét.
- Mockup dùng dữ liệu mẫu. Không hiển thị điểm sức khỏe hoặc mức tăng hiệu năng không được đo.

## Luồng dọn đề xuất

1. Quét chỉ đọc và phân nhóm các file có thể dọn.
2. Xem số file, dung lượng ước lượng và đường dẫn mẫu; chọn nhóm muốn dọn.
3. Xác nhận danh sách và thông báo xóa file không thể hoàn tác.
4. Dọn các file đã quét, xác minh lại chúng vẫn ở trong thư mục được phép.
5. Báo số file đã xóa, dung lượng thực tế, file bỏ qua và lỗi; có thể quét lại.

## Phạm vi dự kiến của bản đầu

- File tạm của tài khoản và báo cáo lỗi cũ: chỉ đề xuất file trên 7 ngày.
- File đang dùng, file mới hoặc đã thay đổi kể từ lần quét sẽ được bỏ qua.
- Không đi qua symbolic link/junction/reparse point. Không nhận đường dẫn xóa tùy ý từ giao diện.
- Không tự dọn Downloads, Desktop, Documents hoặc thư mục dự án.
- Thùng rác và file hệ thống: cung cấp lối mở công cụ Windows, chưa xóa trực tiếp bằng Luma.
- Xóa file không thuộc cơ chế Undo cấu hình hiện có; điểm khôi phục không được mô tả như bản sao lưu file bị xóa.
- Việc kiểm thử chỉ xóa file fixture tạo riêng trong workspace, không dùng dữ liệu thật của người dùng.

## Nguồn tham khảo

- Microsoft — Free up drive space in Windows: https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/free-up-drive-space-in-windows
- Microsoft — Manage drive space with Storage Sense: https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/manage-drive-space-with-storage-sense

Mockup được tạo bằng imagegen tích hợp. Prompt được lưu ở file image-prompt.txt khi ảnh hoàn tất.
