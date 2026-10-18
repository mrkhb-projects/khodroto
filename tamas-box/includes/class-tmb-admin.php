<?php
/**
 * Admin menu & settings page (multi box).
 *
 * @package Tamas_Box
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Admin {

	const SLUG = 'tamas-box';

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_init', array( $this, 'register' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );
	}

	/**
	 * Menu entries.
	 */
	public function menu() {
		$icon = 'data:image/svg+xml;base64,' . base64_encode( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.85 21 3 13.15 3 3.5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z"/></svg>' );

		add_menu_page(
			__( 'تماس باکس', 'tamas-box' ),
			__( 'تماس باکس', 'tamas-box' ),
			'manage_options',
			self::SLUG,
			array( $this, 'render' ),
			$icon,
			58
		);

		add_submenu_page( self::SLUG, __( 'تنظیمات', 'tamas-box' ), __( 'تنظیمات', 'tamas-box' ), 'manage_options', self::SLUG, array( $this, 'render' ) );
		add_submenu_page( self::SLUG, __( 'راهنما', 'tamas-box' ), __( 'راهنما', 'tamas-box' ), 'manage_options', self::SLUG . '-help', array( $this, 'render_help' ) );
	}

	/**
	 * Register the option.
	 */
	public function register() {
		register_setting(
			'tmb_group',
			TMB_OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'TMB_Settings', 'sanitize' ),
			)
		);
	}

	/**
	 * Admin assets.
	 *
	 * @param string $hook Current page.
	 */
	public function assets( $hook ) {
		if ( false === strpos( $hook, self::SLUG ) ) {
			return;
		}

		wp_enqueue_style( 'wp-color-picker' );
		wp_enqueue_style( 'tmb-admin', TMB_URL . 'assets/css/admin.css', array( 'wp-color-picker' ), TMB_VERSION );
		wp_enqueue_style( 'tmb-front', TMB_URL . 'assets/css/frontend.css', array(), TMB_VERSION );

		wp_enqueue_script( 'jquery-ui-sortable' );
		wp_enqueue_script( 'wp-color-picker' );
		wp_enqueue_script( 'tmb-admin', TMB_URL . 'assets/js/admin.js', array( 'jquery', 'wp-color-picker', 'jquery-ui-sortable' ), TMB_VERSION, true );

		$icons = array();
		foreach ( TMB_Icons::all() as $key => $data ) {
			$icons[ $key ] = array(
				'label' => $data['label'],
				'color' => $data['color'],
				'svg'   => $data['svg'],
			);
		}

		wp_localize_script(
			'tmb-admin',
			'TMB_ADMIN',
			array(
				'icons'  => $icons,
				'hints'  => TMB_Icons::hints(),
				'option' => TMB_OPTION,
				'days'   => TMB_Visibility::days(),
				'i18n'   => array(
					'confirmDelete'    => __( 'این آیتم حذف شود؟', 'tamas-box' ),
					'confirmDeleteBox' => __( 'این باکس و همه تنظیماتش حذف شود؟', 'tamas-box' ),
					'newBox'           => __( 'باکس جدید', 'tamas-box' ),
					'lastBox'          => __( 'حداقل یک باکس باید وجود داشته باشد.', 'tamas-box' ),
					'untitled'         => __( 'بدون عنوان', 'tamas-box' ),
					'allDay'           => __( 'تمام روز', 'tamas-box' ),
					'everyDay'         => __( 'همه روزها', 'tamas-box' ),
				),
			)
		);
	}

	/**
	 * Settings screen.
	 */
	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$s     = TMB_Settings::get();
		$o     = TMB_OPTION;
		$icons = TMB_Icons::all();
		?>
		<div class="wrap tmb-wrap" dir="rtl">
			<h1 class="tmb-title">
				<span class="tmb-logo">تب</span>
				<?php esc_html_e( 'تماس باکس', 'tamas-box' ); ?>
				<span class="tmb-ver">v<?php echo esc_html( TMB_VERSION ); ?></span>
			</h1>

			<?php settings_errors(); ?>

			<form method="post" action="options.php" id="tmb-form">
				<?php settings_fields( 'tmb_group' ); ?>

				<div class="tmb-layout">
					<div class="tmb-main">

						<nav class="tmb-tabs">
							<a href="#tab-boxes" class="tmb-tab active"><?php esc_html_e( 'باکس‌های تماس', 'tamas-box' ); ?></a>
							<a href="#tab-chat" class="tmb-tab"><?php esc_html_e( 'چت آنلاین', 'tamas-box' ); ?></a>
							<a href="#tab-global" class="tmb-tab"><?php esc_html_e( 'تنظیمات کلی', 'tamas-box' ); ?></a>
							<a href="#tab-css" class="tmb-tab"><?php esc_html_e( 'CSS سفارشی', 'tamas-box' ); ?></a>
						</nav>

						<!-- ============ باکس‌ها ============ -->
						<section id="tab-boxes" class="tmb-panel active">
							<div class="tmb-section-head">
								<div>
									<h2><?php esc_html_e( 'باکس‌های تماس', 'tamas-box' ); ?></h2>
									<p class="tmb-desc"><?php esc_html_e( 'می‌توانید چند باکس تماس بسازید و برای هرکدام موقعیت، ظاهر، صفحات نمایش و زمان‌بندی جداگانه تعیین کنید.', 'tamas-box' ); ?></p>
								</div>
								<button type="button" class="button button-primary button-hero" id="tmb-add-box">+ <?php esc_html_e( 'باکس جدید', 'tamas-box' ); ?></button>
							</div>

							<div id="tmb-boxes">
								<?php
								$bi = 0;
								foreach ( $s['boxes'] as $box ) {
									$this->box_panel( $bi, $box, $o, $icons );
									$bi++;
								}
								?>
							</div>
						</section>

						<?php
						/* ============ چت آنلاین ============ */
						if ( class_exists( 'TMB_Chat_Admin' ) ) {
							TMB_Chat_Admin::instance()->settings_tab( $o );
						}
						?>

						<!-- ============ تنظیمات کلی ============ -->
						<section id="tab-global" class="tmb-panel">
							<h2><?php esc_html_e( 'تنظیمات کلی', 'tamas-box' ); ?></h2>

							<div class="tmb-field tmb-switch-row">
								<label class="tmb-switch">
									<input type="checkbox" name="<?php echo esc_attr( $o ); ?>[enabled]" value="1" <?php checked( $s['enabled'], 1 ); ?>>
									<span class="tmb-slider"></span>
								</label>
								<div>
									<strong><?php esc_html_e( 'فعال بودن افزونه', 'tamas-box' ); ?></strong>
									<p class="tmb-desc"><?php esc_html_e( 'با خاموش کردن این گزینه، هیچ باکسی در سایت نمایش داده نمی‌شود.', 'tamas-box' ); ?></p>
								</div>
							</div>

							<div class="tmb-grid-2">
								<div class="tmb-field">
									<label><?php esc_html_e( 'جهت متن', 'tamas-box' ); ?></label>
									<select name="<?php echo esc_attr( $o ); ?>[direction]">
										<option value="rtl" <?php selected( $s['direction'], 'rtl' ); ?>><?php esc_html_e( 'راست‌چین (فارسی)', 'tamas-box' ); ?></option>
										<option value="ltr" <?php selected( $s['direction'], 'ltr' ); ?>><?php esc_html_e( 'چپ‌چین', 'tamas-box' ); ?></option>
										<option value="auto" <?php selected( $s['direction'], 'auto' ); ?>><?php esc_html_e( 'خودکار (بر اساس قالب)', 'tamas-box' ); ?></option>
									</select>
								</div>
								<div class="tmb-field">
									<label><?php esc_html_e( 'فونت (اختیاری)', 'tamas-box' ); ?></label>
									<input type="text" name="<?php echo esc_attr( $o ); ?>[font_family]" value="<?php echo esc_attr( $s['font_family'] ); ?>" placeholder="inherit / IRANSans, Vazir, sans-serif">
								</div>
							</div>

							<h3><?php esc_html_e( 'رفتار مشترک همه باکس‌ها', 'tamas-box' ); ?></h3>
							<div class="tmb-grid-3">
								<div class="tmb-field tmb-switch-row">
									<label class="tmb-switch">
										<input type="checkbox" name="<?php echo esc_attr( $o ); ?>[open_on_load]" value="1" <?php checked( $s['open_on_load'], 1 ); ?>>
										<span class="tmb-slider"></span>
									</label>
									<div><strong><?php esc_html_e( 'باز شدن خودکار', 'tamas-box' ); ?></strong></div>
								</div>
								<div class="tmb-field">
									<label><?php esc_html_e( 'تأخیر باز شدن (ثانیه)', 'tamas-box' ); ?></label>
									<input type="number" min="0" max="120" name="<?php echo esc_attr( $o ); ?>[open_delay]" value="<?php echo esc_attr( $s['open_delay'] ); ?>">
								</div>
								<div class="tmb-field tmb-switch-row">
									<label class="tmb-switch">
										<input type="checkbox" name="<?php echo esc_attr( $o ); ?>[close_on_scroll]" value="1" <?php checked( $s['close_on_scroll'], 1 ); ?>>
										<span class="tmb-slider"></span>
									</label>
									<div><strong><?php esc_html_e( 'بستن هنگام اسکرول', 'tamas-box' ); ?></strong></div>
								</div>
							</div>

							<div class="tmb-grid-2">
								<div class="tmb-field tmb-switch-row">
									<label class="tmb-switch">
										<input type="checkbox" name="<?php echo esc_attr( $o ); ?>[remember_state]" value="1" <?php checked( $s['remember_state'], 1 ); ?>>
										<span class="tmb-slider"></span>
									</label>
									<div><strong><?php esc_html_e( 'اگر کاربر بست، دیگر خودکار باز نشود', 'tamas-box' ); ?></strong></div>
								</div>
								<div class="tmb-field">
									<label><?php esc_html_e( 'z-index', 'tamas-box' ); ?></label>
									<input type="number" min="1" name="<?php echo esc_attr( $o ); ?>[z_index]" value="<?php echo esc_attr( $s['z_index'] ); ?>">
								</div>
							</div>

							<div class="tmb-grid-2">
								<div class="tmb-field">
									<label><?php esc_html_e( 'رنگ پس‌زمینه تیره (اورلی)', 'tamas-box' ); ?></label>
									<input type="text" class="tmb-color" name="<?php echo esc_attr( $o ); ?>[overlay_color]" value="<?php echo esc_attr( $s['overlay_color'] ); ?>">
									<p class="tmb-desc"><?php esc_html_e( 'مثال: rgba(15,23,42,.45)', 'tamas-box' ); ?></p>
								</div>
								<div class="tmb-field tmb-switch-row">
									<label class="tmb-switch">
										<input type="checkbox" name="<?php echo esc_attr( $o ); ?>[overlay_desktop]" value="1" <?php checked( $s['overlay_desktop'], 1 ); ?>>
										<span class="tmb-slider"></span>
									</label>
									<div><strong><?php esc_html_e( 'نمایش اورلی در دسکتاپ هم', 'tamas-box' ); ?></strong></div>
								</div>
							</div>
						</section>

						<!-- ============ CSS ============ -->
						<section id="tab-css" class="tmb-panel">
							<h2><?php esc_html_e( 'CSS سفارشی', 'tamas-box' ); ?></h2>
							<p class="tmb-desc"><?php esc_html_e( 'نمونه کلاس‌ها: .tmb-btn ، .tmb-panel ، .tmb-item — برای هدف گرفتن یک باکس خاص از شناسه آن استفاده کنید، مثل #tmb-box1', 'tamas-box' ); ?></p>
							<textarea name="<?php echo esc_attr( $o ); ?>[custom_css]" rows="12" class="tmb-code" spellcheck="false"><?php echo esc_textarea( $s['custom_css'] ); ?></textarea>

							<h3><?php esc_html_e( 'شورتکد', 'tamas-box' ); ?></h3>
							<p class="tmb-desc"><?php esc_html_e( 'باکس ثابت داخل محتوا:', 'tamas-box' ); ?> <code>[tamas_box]</code> <?php esc_html_e( 'یا با شناسه:', 'tamas-box' ); ?> <code>[tamas_box id="box2"]</code></p>
							<p class="tmb-desc"><?php esc_html_e( 'دکمه داخل محتوا:', 'tamas-box' ); ?> <code>[tamas_button text="تماس با ما"]</code> <?php esc_html_e( 'یا با شناسه:', 'tamas-box' ); ?> <code>[tamas_button id="box2"]</code></p>
						</section>

						<?php submit_button( __( 'ذخیره تنظیمات', 'tamas-box' ), 'primary large', 'submit', true ); ?>
					</div>

					<!-- ============ پیش‌نمایش ============ -->
					<aside class="tmb-side">
						<div class="tmb-preview-card">
							<div class="tmb-preview-head">
								<strong><?php esc_html_e( 'پیش‌نمایش زنده', 'tamas-box' ); ?></strong>
								<div class="tmb-preview-switch">
									<button type="button" class="tmb-pv active" data-mode="desktop"><?php esc_html_e( 'دسکتاپ', 'tamas-box' ); ?></button>
									<button type="button" class="tmb-pv" data-mode="mobile"><?php esc_html_e( 'موبایل', 'tamas-box' ); ?></button>
								</div>
							</div>
							<div id="tmb-preview" class="tmb-preview desktop"></div>
							<p class="tmb-desc tmb-center"><?php esc_html_e( 'همه باکس‌های فعال نمایش داده می‌شوند. برای باز کردن، روی هر دکمه کلیک کنید.', 'tamas-box' ); ?></p>
						</div>

						<div class="tmb-author-card">
							<span class="tmb-author-label"><?php esc_html_e( 'طراحی و توسعه', 'tamas-box' ); ?></span>
							<strong><?php echo esc_html( TMB_AUTHOR ); ?></strong>
							<a href="<?php echo esc_url( TMB_AUTHOR_URL ); ?>" target="_blank" rel="noopener">www.mrkhodabakhshi.ir</a>
						</div>
					</aside>
				</div>
			</form>
		</div>
		<?php
		$this->box_template( $o, $icons );
		$this->item_template( $o, $icons );
		$this->range_template( $o );
	}

	/**
	 * One collapsible box panel with its own inner tabs.
	 *
	 * @param int|string $bi    Box index or __b__ placeholder.
	 * @param array      $box   Box data.
	 * @param string     $o     Option name.
	 * @param array      $icons Icons.
	 */
	protected function box_panel( $bi, $box, $o, $icons ) {
		$box       = wp_parse_args( $box, TMB_Settings::box_defaults() );
		$n         = $o . '[boxes][' . $bi . ']';
		$uid       = 'b' . $bi;
		$positions = TMB_Settings::positions();
		$pos_label = isset( $positions[ $box['position'] ] ) ? $positions[ $box['position'] ] : $box['position'];
		?>
		<div class="tmb-box <?php echo $box['enabled'] ? '' : 'is-off'; ?>" data-bi="<?php echo esc_attr( $bi ); ?>">

			<div class="tmb-box-head">
				<span class="tmb-drag tmb-box-drag" title="<?php esc_attr_e( 'جابجایی', 'tamas-box' ); ?>">⋮⋮</span>

				<span class="tmb-box-swatch" style="background:linear-gradient(135deg,<?php echo esc_attr( $box['btn_color_1'] ); ?>,<?php echo esc_attr( $box['btn_color_2'] ); ?>)">
					<?php echo TMB_Icons::svg( $box['btn_icon'] ); // phpcs:ignore ?>
				</span>

				<span class="tmb-box-titles">
					<strong class="tmb-box-name"><?php echo esc_html( $box['name'] ); ?></strong>
					<span class="tmb-box-meta">
						<span class="tmb-chip-pos"><?php echo esc_html( $pos_label ); ?></span>
						<span class="tmb-chip-count"><?php echo esc_html( count( $box['items'] ) ); ?> <?php esc_html_e( 'آیتم', 'tamas-box' ); ?></span>
						<?php if ( ! empty( $box['schedule_enabled'] ) ) : ?>
							<span class="tmb-chip-time">⏰ <?php esc_html_e( 'زمان‌بندی فعال', 'tamas-box' ); ?></span>
						<?php endif; ?>
					</span>
				</span>

				<input type="hidden" class="tmb-box-id" name="<?php echo esc_attr( $n ); ?>[id]" value="<?php echo esc_attr( $box['id'] ); ?>">

				<label class="tmb-switch small" title="<?php esc_attr_e( 'فعال / غیرفعال', 'tamas-box' ); ?>">
					<input type="checkbox" class="tmb-box-enabled" name="<?php echo esc_attr( $n ); ?>[enabled]" value="1" <?php checked( $box['enabled'], 1 ); ?>>
					<span class="tmb-slider"></span>
				</label>
				<button type="button" class="tmb-dup-box" title="<?php esc_attr_e( 'تکثیر', 'tamas-box' ); ?>">⧉</button>
				<button type="button" class="tmb-toggle-box" title="<?php esc_attr_e( 'باز / بسته', 'tamas-box' ); ?>">✎</button>
				<button type="button" class="tmb-remove-box" title="<?php esc_attr_e( 'حذف', 'tamas-box' ); ?>">✕</button>
			</div>

			<div class="tmb-box-body">

				<nav class="tmb-subtabs">
					<a href="#" class="tmb-subtab active" data-sub="general"><?php esc_html_e( 'عمومی', 'tamas-box' ); ?></a>
					<a href="#" class="tmb-subtab" data-sub="position"><?php esc_html_e( 'موقعیت', 'tamas-box' ); ?></a>
					<a href="#" class="tmb-subtab" data-sub="items"><?php esc_html_e( 'آیتم‌ها', 'tamas-box' ); ?></a>
					<a href="#" class="tmb-subtab" data-sub="design"><?php esc_html_e( 'ظاهر', 'tamas-box' ); ?></a>
					<a href="#" class="tmb-subtab" data-sub="pages"><?php esc_html_e( 'صفحات', 'tamas-box' ); ?></a>
					<a href="#" class="tmb-subtab" data-sub="schedule"><?php esc_html_e( 'زمان‌بندی', 'tamas-box' ); ?></a>
				</nav>

				<!-- ---------- عمومی ---------- -->
				<div class="tmb-subpanel active" data-sub="general">
					<div class="tmb-grid-2">
						<div class="tmb-field">
							<label><?php esc_html_e( 'نام باکس (فقط در پیشخوان)', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-name-input" name="<?php echo esc_attr( $n ); ?>[name]" value="<?php echo esc_attr( $box['name'] ); ?>" placeholder="<?php esc_attr_e( 'مثلاً باکس ساعات کاری', 'tamas-box' ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'شناسه باکس (برای شورتکد و CSS)', 'tamas-box' ); ?></label>
							<input type="text" class="ltr" value="<?php echo esc_attr( $box['id'] ); ?>" readonly onclick="this.select()">
						</div>
					</div>

					<div class="tmb-grid-2">
						<div class="tmb-field">
							<label><?php esc_html_e( 'متن دکمه', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[btn_text]" value="<?php echo esc_attr( $box['btn_text'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'متن تولتیپ', 'tamas-box' ); ?></label>
							<input type="text" name="<?php echo esc_attr( $n ); ?>[btn_tooltip]" value="<?php echo esc_attr( $box['btn_tooltip'] ); ?>">
						</div>
					</div>

					<div class="tmb-grid-2">
						<div class="tmb-field tmb-switch-row">
							<label class="tmb-switch">
								<input type="checkbox" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[btn_show_text]" value="1" <?php checked( $box['btn_show_text'], 1 ); ?>>
								<span class="tmb-slider"></span>
							</label>
							<div><strong><?php esc_html_e( 'نمایش متن روی دکمه', 'tamas-box' ); ?></strong></div>
						</div>
						<div class="tmb-field tmb-switch-row">
							<label class="tmb-switch">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[btn_show_tooltip]" value="1" <?php checked( $box['btn_show_tooltip'], 1 ); ?>>
								<span class="tmb-slider"></span>
							</label>
							<div><strong><?php esc_html_e( 'نمایش تولتیپ', 'tamas-box' ); ?></strong></div>
						</div>
					</div>

					<div class="tmb-grid-2">
						<div class="tmb-field">
							<label><?php esc_html_e( 'عنوان باکس', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_title]" value="<?php echo esc_attr( $box['panel_title'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'زیرعنوان باکس', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_subtitle]" value="<?php echo esc_attr( $box['panel_subtitle'] ); ?>">
						</div>
					</div>

					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_show_head]" value="1" <?php checked( $box['panel_show_head'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div><strong><?php esc_html_e( 'نمایش سربرگ در باکس', 'tamas-box' ); ?></strong></div>
					</div>

					<div class="tmb-field">
						<label><?php esc_html_e( 'آیکون دکمه', 'tamas-box' ); ?></label>
						<div class="tmb-iconpick tmb-btn-iconpick">
							<?php foreach ( $icons as $key => $data ) : ?>
								<button type="button" class="tmb-iconopt <?php echo $box['btn_icon'] === $key ? 'selected' : ''; ?>" data-icon="<?php echo esc_attr( $key ); ?>" title="<?php echo esc_attr( $data['label'] ); ?>">
									<?php echo TMB_Icons::svg( $key ); // phpcs:ignore ?>
								</button>
							<?php endforeach; ?>
						</div>
						<input type="hidden" class="tmb-btn-icon-input tmb-live" name="<?php echo esc_attr( $n ); ?>[btn_icon]" value="<?php echo esc_attr( $box['btn_icon'] ); ?>">
					</div>

					<div class="tmb-grid-3">
						<div class="tmb-field">
							<label><?php esc_html_e( 'متن دکمه بستن', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[close_text]" value="<?php echo esc_attr( $box['close_text'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'حالت دکمه بستن', 'tamas-box' ); ?></label>
							<select class="tmb-live" name="<?php echo esc_attr( $n ); ?>[close_style]">
								<option value="outline" <?php selected( $box['close_style'], 'outline' ); ?>><?php esc_html_e( 'خط‌دار', 'tamas-box' ); ?></option>
								<option value="solid" <?php selected( $box['close_style'], 'solid' ); ?>><?php esc_html_e( 'پُررنگ', 'tamas-box' ); ?></option>
								<option value="icon" <?php selected( $box['close_style'], 'icon' ); ?>><?php esc_html_e( 'فقط آیکون', 'tamas-box' ); ?></option>
							</select>
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'رنگ دکمه بستن', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[close_color]" value="<?php echo esc_attr( $box['close_color'] ); ?>">
						</div>
					</div>
				</div>

				<!-- ---------- موقعیت ---------- -->
				<div class="tmb-subpanel" data-sub="position">
					<div class="tmb-field">
						<label><?php esc_html_e( 'موقعیت دکمه در صفحه', 'tamas-box' ); ?></label>
						<p class="tmb-desc"><?php esc_html_e( 'روی محل دلخواه کلیک کنید. در موبایل، باکس همیشه از پایین صفحه باز می‌شود.', 'tamas-box' ); ?></p>

						<div class="tmb-posgrid">
							<?php
							$order = array( 'top-left', 'top-center', 'top-right', 'middle-left', '', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right' );
							foreach ( $order as $key ) :
								if ( '' === $key ) :
									?>
									<span class="tmb-poscell tmb-poscell-empty" aria-hidden="true">
										<span class="tmb-screen-hint"><?php esc_html_e( 'صفحه سایت', 'tamas-box' ); ?></span>
									</span>
									<?php
									continue;
								endif;
								?>
								<button type="button" class="tmb-poscell <?php echo $box['position'] === $key ? 'selected' : ''; ?>" data-pos="<?php echo esc_attr( $key ); ?>" title="<?php echo esc_attr( $positions[ $key ] ); ?>">
									<span class="tmb-posdot"></span>
									<span class="tmb-poslabel"><?php echo esc_html( $positions[ $key ] ); ?></span>
								</button>
							<?php endforeach; ?>
						</div>
						<input type="hidden" class="tmb-position-input tmb-live" name="<?php echo esc_attr( $n ); ?>[position]" value="<?php echo esc_attr( $box['position'] ); ?>">
					</div>

					<div class="tmb-grid-3">
						<div class="tmb-field">
							<label><?php esc_html_e( 'فاصله افقی از لبه (px)', 'tamas-box' ); ?></label>
							<input type="number" min="0" max="400" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[offset_x]" value="<?php echo esc_attr( $box['offset_x'] ); ?>">
							<p class="tmb-desc"><?php esc_html_e( 'در حالت «وسط» بی‌اثر است.', 'tamas-box' ); ?></p>
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'فاصله عمودی دسکتاپ (px)', 'tamas-box' ); ?></label>
							<input type="number" min="0" max="400" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[offset_y]" value="<?php echo esc_attr( $box['offset_y'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'فاصله از پایین در موبایل (px)', 'tamas-box' ); ?></label>
							<input type="number" min="0" max="240" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[mobile_offset_y]" value="<?php echo esc_attr( isset( $box['mobile_offset_y'] ) ? $box['mobile_offset_y'] : 88 ); ?>">
						</div>
					</div>

					<div class="tmb-mobile-offset-note">
						<strong><?php esc_html_e( 'جلوگیری از هم‌پوشانی با منوی پایین موبایل', 'tamas-box' ); ?></strong>
						<p class="tmb-desc" style="margin:0"><?php esc_html_e( 'اگر قالب شما نوار پایین (مثل صفحه اصلی / محصولات / سبدخرید) دارد، این عدد را بین ۸۰ تا ۱۲۰ بگذارید تا دکمه روی منو نیاید. پیش‌فرض: ۸۸ پیکسل.', 'tamas-box' ); ?></p>
					</div>

					<h3><?php esc_html_e( 'نمایش بر اساس دستگاه', 'tamas-box' ); ?></h3>
					<div class="tmb-grid-2">
						<div class="tmb-field tmb-switch-row">
							<label class="tmb-switch">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[show_desktop]" value="1" <?php checked( $box['show_desktop'], 1 ); ?>>
								<span class="tmb-slider"></span>
							</label>
							<div><strong><?php esc_html_e( 'نمایش در دسکتاپ', 'tamas-box' ); ?></strong></div>
						</div>
						<div class="tmb-field tmb-switch-row">
							<label class="tmb-switch">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[show_mobile]" value="1" <?php checked( $box['show_mobile'], 1 ); ?>>
								<span class="tmb-slider"></span>
							</label>
							<div><strong><?php esc_html_e( 'نمایش در موبایل', 'tamas-box' ); ?></strong></div>
						</div>
					</div>
				</div>

				<!-- ---------- آیتم‌ها ---------- -->
				<div class="tmb-subpanel" data-sub="items">
					<div class="tmb-items-toolbar">
						<button type="button" class="button button-primary tmb-add-item">+ <?php esc_html_e( 'افزودن آیتم', 'tamas-box' ); ?></button>
						<button type="button" class="button tmb-add-chat-item" title="<?php esc_attr_e( 'یک آیتم «چت آنلاین» اضافه می‌کند که پنجره چت را باز می‌کند.', 'tamas-box' ); ?>">💬 + <?php esc_html_e( 'آیتم چت آنلاین', 'tamas-box' ); ?></button>
						<span class="tmb-hint"><?php esc_html_e( 'برای تماس مستقیم از قالب tel:09121234567 استفاده کنید.', 'tamas-box' ); ?></span>
					</div>

					<div class="tmb-items-list">
						<?php
						$ii = 0;
						foreach ( $box['items'] as $item ) {
							$this->item_row( $bi, $ii, $item, $o, $icons );
							$ii++;
						}
						?>
					</div>
				</div>

				<!-- ---------- ظاهر ---------- -->
				<div class="tmb-subpanel" data-sub="design">
					<div class="tmb-grid-3">
						<div class="tmb-field">
							<label><?php esc_html_e( 'چیدمان آیتم‌ها', 'tamas-box' ); ?></label>
							<select class="tmb-live" name="<?php echo esc_attr( $n ); ?>[item_style]">
								<option value="row" <?php selected( $box['item_style'], 'row' ); ?>><?php esc_html_e( 'ردیفی', 'tamas-box' ); ?></option>
								<option value="card" <?php selected( $box['item_style'], 'card' ); ?>><?php esc_html_e( 'کارتی', 'tamas-box' ); ?></option>
								<option value="grid" <?php selected( $box['item_style'], 'grid' ); ?>><?php esc_html_e( 'شبکه‌ای', 'tamas-box' ); ?></option>
							</select>
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'شکل آیکون', 'tamas-box' ); ?></label>
							<select class="tmb-live" name="<?php echo esc_attr( $n ); ?>[icon_shape]">
								<option value="circle" <?php selected( $box['icon_shape'], 'circle' ); ?>><?php esc_html_e( 'دایره', 'tamas-box' ); ?></option>
								<option value="rounded" <?php selected( $box['icon_shape'], 'rounded' ); ?>><?php esc_html_e( 'مربع گرد', 'tamas-box' ); ?></option>
								<option value="square" <?php selected( $box['icon_shape'], 'square' ); ?>><?php esc_html_e( 'مربع', 'tamas-box' ); ?></option>
								<option value="plain" <?php selected( $box['icon_shape'], 'plain' ); ?>><?php esc_html_e( 'بدون پس‌زمینه', 'tamas-box' ); ?></option>
							</select>
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'انیمیشن باز شدن', 'tamas-box' ); ?></label>
							<select name="<?php echo esc_attr( $n ); ?>[animation]">
								<option value="slide" <?php selected( $box['animation'], 'slide' ); ?>><?php esc_html_e( 'کشویی', 'tamas-box' ); ?></option>
								<option value="fade" <?php selected( $box['animation'], 'fade' ); ?>><?php esc_html_e( 'محو', 'tamas-box' ); ?></option>
								<option value="zoom" <?php selected( $box['animation'], 'zoom' ); ?>><?php esc_html_e( 'بزرگ‌نمایی', 'tamas-box' ); ?></option>
							</select>
						</div>
					</div>

					<div class="tmb-grid-3">
						<div class="tmb-field">
							<label><?php esc_html_e( 'اندازه دکمه (px)', 'tamas-box' ); ?></label>
							<input type="number" min="36" max="120" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[btn_size]" value="<?php echo esc_attr( $box['btn_size'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'گردی دکمه (%)', 'tamas-box' ); ?></label>
							<input type="number" min="0" max="50" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[btn_radius]" value="<?php echo esc_attr( $box['btn_radius'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'اندازه آیکون آیتم (px)', 'tamas-box' ); ?></label>
							<input type="number" min="24" max="72" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[icon_size]" value="<?php echo esc_attr( $box['icon_size'] ); ?>">
						</div>
					</div>

					<div class="tmb-grid-2">
						<div class="tmb-field">
							<label><?php esc_html_e( 'عرض باکس دسکتاپ (px)', 'tamas-box' ); ?></label>
							<input type="number" min="240" max="560" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_width]" value="<?php echo esc_attr( $box['panel_width'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'گردی گوشه باکس (px)', 'tamas-box' ); ?></label>
							<input type="number" min="0" max="40" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_radius]" value="<?php echo esc_attr( $box['panel_radius'] ); ?>">
						</div>
					</div>

					<div class="tmb-color-card tmb-btn-color-card">
						<h3><?php esc_html_e( 'رنگ دکمه و آیکون شناور', 'tamas-box' ); ?></h3>
						<p class="tmb-desc"><?php esc_html_e( 'رنگ پس‌زمینه دکمه، گرادیانت و رنگ آیکون/متن را از اینجا تغییر دهید. با کلیک روی نمونه‌های رنگی هم می‌توانید سریع انتخاب کنید.', 'tamas-box' ); ?></p>

						<div class="tmb-btn-live-preview" data-live-btn style="background:linear-gradient(135deg,<?php echo esc_attr( $box['btn_color_1'] ); ?>,<?php echo esc_attr( $box['btn_color_2'] ? $box['btn_color_2'] : $box['btn_color_1'] ); ?>);color:<?php echo esc_attr( $box['btn_icon_color'] ); ?>">
							<?php echo TMB_Icons::svg( $box['btn_icon'] ); // phpcs:ignore ?>
							<span><?php echo esc_html( $box['btn_text'] ? $box['btn_text'] : __( 'تماس با ما', 'tamas-box' ) ); ?></span>
						</div>

						<div class="tmb-preset-row" aria-label="<?php esc_attr_e( 'پالت‌های آماده', 'tamas-box' ); ?>">
							<?php
							$presets = array(
								array( '#22c55e', '#16a34a', '#ffffff' ),
								array( '#c99a5b', '#a97c3f', '#ffffff' ),
								array( '#ef4444', '#dc2626', '#ffffff' ),
								array( '#3b82f6', '#2563eb', '#ffffff' ),
								array( '#8b5cf6', '#7c3aed', '#ffffff' ),
								array( '#0f172a', '#334155', '#ffffff' ),
								array( '#f59e0b', '#d97706', '#111827' ),
								array( '#14b8a6', '#0d9488', '#ffffff' ),
								array( '#ec4899', '#db2777', '#ffffff' ),
								array( '#111827', '#000000', '#fbbf24' ),
							);
							foreach ( $presets as $p ) :
								?>
								<button type="button" class="tmb-color-preset" title="<?php esc_attr_e( 'اعمال این رنگ', 'tamas-box' ); ?>" data-c1="<?php echo esc_attr( $p[0] ); ?>" data-c2="<?php echo esc_attr( $p[1] ); ?>" data-fg="<?php echo esc_attr( $p[2] ); ?>" style="background:linear-gradient(135deg,<?php echo esc_attr( $p[0] ); ?>,<?php echo esc_attr( $p[1] ); ?>)"></button>
							<?php endforeach; ?>
						</div>

						<div class="tmb-grid-3">
							<div class="tmb-field">
								<label><?php esc_html_e( 'رنگ اصلی دکمه', 'tamas-box' ); ?></label>
								<input type="text" class="tmb-color tmb-live tmb-btn-c1" name="<?php echo esc_attr( $n ); ?>[btn_color_1]" value="<?php echo esc_attr( $box['btn_color_1'] ); ?>">
							</div>
							<div class="tmb-field">
								<label><?php esc_html_e( 'رنگ دوم (گرادیانت)', 'tamas-box' ); ?></label>
								<input type="text" class="tmb-color tmb-live tmb-btn-c2" name="<?php echo esc_attr( $n ); ?>[btn_color_2]" value="<?php echo esc_attr( $box['btn_color_2'] ); ?>">
							</div>
							<div class="tmb-field">
								<label><?php esc_html_e( 'رنگ آیکون و متن دکمه', 'tamas-box' ); ?></label>
								<input type="text" class="tmb-color tmb-live tmb-btn-fg" name="<?php echo esc_attr( $n ); ?>[btn_icon_color]" value="<?php echo esc_attr( $box['btn_icon_color'] ); ?>">
							</div>
						</div>

						<div class="tmb-grid-3">
							<div class="tmb-field tmb-switch-row">
								<label class="tmb-switch">
									<input type="checkbox" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[btn_shadow]" value="1" <?php checked( $box['btn_shadow'], 1 ); ?>>
									<span class="tmb-slider"></span>
								</label>
								<div><strong><?php esc_html_e( 'سایه دکمه', 'tamas-box' ); ?></strong></div>
							</div>
							<div class="tmb-field tmb-switch-row">
								<label class="tmb-switch">
									<input type="checkbox" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[btn_pulse]" value="1" <?php checked( $box['btn_pulse'], 1 ); ?>>
									<span class="tmb-slider"></span>
								</label>
								<div><strong><?php esc_html_e( 'انیمیشن تپش', 'tamas-box' ); ?></strong></div>
							</div>
							<div class="tmb-field">
								<label><?php esc_html_e( 'رنگ تپش', 'tamas-box' ); ?></label>
								<input type="text" class="tmb-color tmb-live tmb-btn-pulse" name="<?php echo esc_attr( $n ); ?>[btn_pulse_color]" value="<?php echo esc_attr( $box['btn_pulse_color'] ); ?>">
							</div>
						</div>
					</div>

					<h3><?php esc_html_e( 'رنگ باکس', 'tamas-box' ); ?></h3>
					<div class="tmb-grid-3">
						<div class="tmb-field">
							<label><?php esc_html_e( 'پس‌زمینه باکس', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_bg]" value="<?php echo esc_attr( $box['panel_bg'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'پس‌زمینه سربرگ', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_head_bg]" value="<?php echo esc_attr( $box['panel_head_bg'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'رنگ متن سربرگ', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_head_text]" value="<?php echo esc_attr( $box['panel_head_text'] ); ?>">
						</div>
					</div>

					<div class="tmb-grid-3">
						<div class="tmb-field">
							<label><?php esc_html_e( 'رنگ زیرعنوان', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[panel_sub_text]" value="<?php echo esc_attr( $box['panel_sub_text'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'پس‌زمینه آیتم', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[item_bg]" value="<?php echo esc_attr( $box['item_bg'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'هاور آیتم', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[item_hover_bg]" value="<?php echo esc_attr( $box['item_hover_bg'] ); ?>">
						</div>
					</div>

					<div class="tmb-grid-3">
						<div class="tmb-field">
							<label><?php esc_html_e( 'رنگ متن آیتم', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[item_text]" value="<?php echo esc_attr( $box['item_text'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'رنگ توضیح آیتم', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[item_sub_text]" value="<?php echo esc_attr( $box['item_sub_text'] ); ?>">
						</div>
						<div class="tmb-field">
							<label><?php esc_html_e( 'رنگ جداکننده', 'tamas-box' ); ?></label>
							<input type="text" class="tmb-color tmb-live" name="<?php echo esc_attr( $n ); ?>[item_divider]" value="<?php echo esc_attr( $box['item_divider'] ); ?>">
						</div>
					</div>

					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" class="tmb-live" name="<?php echo esc_attr( $n ); ?>[use_brand_colors]" value="1" <?php checked( $box['use_brand_colors'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div>
							<strong><?php esc_html_e( 'استفاده از رنگ برند هر آیکون', 'tamas-box' ); ?></strong>
							<p class="tmb-desc"><?php esc_html_e( 'مثلاً واتساپ سبز، تلگرام آبی.', 'tamas-box' ); ?></p>
						</div>
					</div>
				</div>

				<!-- ---------- صفحات ---------- -->
				<div class="tmb-subpanel" data-sub="pages">
					<?php $this->pages_rules( $n, $box ); ?>
				</div>

				<!-- ---------- زمان‌بندی ---------- -->
				<div class="tmb-subpanel" data-sub="schedule">
					<?php $this->schedule_rules( $n, $box, $uid ); ?>
				</div>

			</div>
		</div>
		<?php
	}

	/**
	 * Page visibility rules for one box.
	 *
	 * @param string $n   Field name prefix.
	 * @param array  $box Box data.
	 */
	protected function pages_rules( $n, $box ) {
		$page_types = TMB_Visibility::page_types();
		$post_types = TMB_Visibility::post_types();
		?>
		<p class="tmb-desc"><?php esc_html_e( 'تعیین کنید این باکس در کدام صفحات نمایش داده شود و در کدام صفحات نه. قوانین «نمایش داده نشود» همیشه اولویت دارند.', 'tamas-box' ); ?></p>

		<div class="tmb-field">
			<label><?php esc_html_e( 'حالت کلی نمایش', 'tamas-box' ); ?></label>
			<div class="tmb-radio-cards">
				<label class="tmb-radio-card <?php echo 'all' === $box['display_mode'] ? 'selected' : ''; ?>">
					<input type="radio" class="tmb-mode-radio" name="<?php echo esc_attr( $n ); ?>[display_mode]" value="all" <?php checked( $box['display_mode'], 'all' ); ?>>
					<span class="tmb-rc-title"><?php esc_html_e( 'در همه صفحات', 'tamas-box' ); ?></span>
					<span class="tmb-rc-desc"><?php esc_html_e( 'همه‌جا نمایش داده می‌شود، به‌جز موارد کادر قرمز.', 'tamas-box' ); ?></span>
				</label>
				<label class="tmb-radio-card <?php echo 'only' === $box['display_mode'] ? 'selected' : ''; ?>">
					<input type="radio" class="tmb-mode-radio" name="<?php echo esc_attr( $n ); ?>[display_mode]" value="only" <?php checked( $box['display_mode'], 'only' ); ?>>
					<span class="tmb-rc-title"><?php esc_html_e( 'فقط در صفحات انتخابی', 'tamas-box' ); ?></span>
					<span class="tmb-rc-desc"><?php esc_html_e( 'فقط در موارد کادر سبز ظاهر می‌شود.', 'tamas-box' ); ?></span>
				</label>
			</div>
		</div>

		<div class="tmb-rulebox tmb-rules-show">
			<div class="tmb-rulebox-head tmb-green">
				<span class="tmb-dot"></span>
				<strong><?php esc_html_e( 'نمایش داده شود در', 'tamas-box' ); ?></strong>
			</div>
			<div class="tmb-rulebox-body">
				<div class="tmb-field">
					<label><?php esc_html_e( 'نوع صفحات', 'tamas-box' ); ?></label>
					<div class="tmb-checkgrid">
						<?php foreach ( $page_types as $key => $label ) : ?>
							<label class="tmb-checkchip">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[show_types][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $box['show_types'], true ) ); ?>>
								<span><?php echo esc_html( $label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'انواع محتوا', 'tamas-box' ); ?></label>
					<div class="tmb-checkgrid">
						<?php foreach ( $post_types as $key => $label ) : ?>
							<label class="tmb-checkchip">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[show_post_types][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $box['show_post_types'], true ) ); ?>>
								<span><?php echo esc_html( $label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'شناسه برگه/نوشته', 'tamas-box' ); ?></label>
						<input type="text" class="ltr" name="<?php echo esc_attr( $n ); ?>[show_ids]" value="<?php echo esc_attr( $box['show_ids'] ); ?>" placeholder="12, 45, 108">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'شناسه دسته/برچسب', 'tamas-box' ); ?></label>
						<input type="text" class="ltr" name="<?php echo esc_attr( $n ); ?>[show_terms]" value="<?php echo esc_attr( $box['show_terms'] ); ?>" placeholder="3, 17">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'آدرس‌های خاص (هر خط یک مورد)', 'tamas-box' ); ?></label>
					<textarea class="ltr" rows="2" name="<?php echo esc_attr( $n ); ?>[url_show]" placeholder="/contact&#10;/shop/*"><?php echo esc_textarea( $box['url_show'] ); ?></textarea>
				</div>
			</div>
		</div>

		<div class="tmb-rulebox">
			<div class="tmb-rulebox-head tmb-red">
				<span class="tmb-dot"></span>
				<strong><?php esc_html_e( 'نمایش داده نشود در', 'tamas-box' ); ?></strong>
				<span class="tmb-badge-note"><?php esc_html_e( 'همیشه اولویت دارد', 'tamas-box' ); ?></span>
			</div>
			<div class="tmb-rulebox-body">
				<div class="tmb-field">
					<label><?php esc_html_e( 'نوع صفحات', 'tamas-box' ); ?></label>
					<div class="tmb-checkgrid">
						<?php foreach ( $page_types as $key => $label ) : ?>
							<label class="tmb-checkchip tmb-chip-red">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[hide_types][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $box['hide_types'], true ) ); ?>>
								<span><?php echo esc_html( $label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'انواع محتوا', 'tamas-box' ); ?></label>
					<div class="tmb-checkgrid">
						<?php foreach ( $post_types as $key => $label ) : ?>
							<label class="tmb-checkchip tmb-chip-red">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[hide_post_types][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $box['hide_post_types'], true ) ); ?>>
								<span><?php echo esc_html( $label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'شناسه برگه/نوشته', 'tamas-box' ); ?></label>
						<input type="text" class="ltr" name="<?php echo esc_attr( $n ); ?>[hide_ids]" value="<?php echo esc_attr( $box['hide_ids'] ); ?>" placeholder="7, 22">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'شناسه دسته/برچسب', 'tamas-box' ); ?></label>
						<input type="text" class="ltr" name="<?php echo esc_attr( $n ); ?>[hide_terms]" value="<?php echo esc_attr( $box['hide_terms'] ); ?>" placeholder="5">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'آدرس‌های خاص (هر خط یک مورد)', 'tamas-box' ); ?></label>
					<textarea class="ltr" rows="2" name="<?php echo esc_attr( $n ); ?>[url_hide]" placeholder="/checkout&#10;/cart"><?php echo esc_textarea( $box['url_hide'] ); ?></textarea>
				</div>
			</div>
		</div>

		<h3><?php esc_html_e( 'نمایش بر اساس کاربران', 'tamas-box' ); ?></h3>
		<div class="tmb-grid-2">
			<div class="tmb-field">
				<label><?php esc_html_e( 'برای چه کاربرانی؟', 'tamas-box' ); ?></label>
				<select class="tmb-user-mode" name="<?php echo esc_attr( $n ); ?>[user_mode]">
					<option value="all" <?php selected( $box['user_mode'], 'all' ); ?>><?php esc_html_e( 'همه بازدیدکنندگان', 'tamas-box' ); ?></option>
					<option value="logged_in" <?php selected( $box['user_mode'], 'logged_in' ); ?>><?php esc_html_e( 'فقط کاربران وارد شده', 'tamas-box' ); ?></option>
					<option value="logged_out" <?php selected( $box['user_mode'], 'logged_out' ); ?>><?php esc_html_e( 'فقط مهمان‌ها', 'tamas-box' ); ?></option>
					<option value="roles" <?php selected( $box['user_mode'], 'roles' ); ?>><?php esc_html_e( 'فقط نقش‌های انتخابی', 'tamas-box' ); ?></option>
				</select>
			</div>
			<div class="tmb-field tmb-roles-field">
				<label><?php esc_html_e( 'نقش‌های کاربری', 'tamas-box' ); ?></label>
				<div class="tmb-checkgrid">
					<?php
					$roles = function_exists( 'wp_roles' ) ? wp_roles()->get_names() : array();
					foreach ( $roles as $key => $label ) :
						?>
						<label class="tmb-checkchip">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[user_roles][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $box['user_roles'], true ) ); ?>>
							<span><?php echo esc_html( translate_user_role( $label ) ); ?></span>
						</label>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * Schedule rules for one box.
	 *
	 * @param string $n   Field name prefix.
	 * @param array  $box Box data.
	 * @param string $uid Unique suffix.
	 */
	protected function schedule_rules( $n, $box, $uid ) {
		$days = TMB_Visibility::days();
		?>
		<div class="tmb-field tmb-switch-row">
			<label class="tmb-switch">
				<input type="checkbox" class="tmb-sched-toggle" name="<?php echo esc_attr( $n ); ?>[schedule_enabled]" value="1" <?php checked( $box['schedule_enabled'], 1 ); ?>>
				<span class="tmb-slider"></span>
			</label>
			<div>
				<strong><?php esc_html_e( 'فعال کردن زمان‌بندی برای این باکس', 'tamas-box' ); ?></strong>
				<p class="tmb-desc"><?php esc_html_e( 'این باکس فقط در روزها و ساعت‌های تعیین شده نمایش داده می‌شود. مثلاً یک باکس برای ساعات کاری و یک باکس دیگر برای خارج از ساعات کاری.', 'tamas-box' ); ?></p>
			</div>
		</div>

		<div class="tmb-sched-fields">
			<div class="tmb-timeblock tmb-timeblock-main">
				<div class="tmb-timeblock-head">
					<strong><?php esc_html_e( 'بازه اصلی', 'tamas-box' ); ?></strong>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'روزهای هفته', 'tamas-box' ); ?></label>
					<div class="tmb-checkgrid tmb-daygrid">
						<?php foreach ( $days as $key => $label ) : ?>
							<label class="tmb-checkchip">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[schedule_days][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $box['schedule_days'], true ) ); ?>>
								<span><?php echo esc_html( $label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
					<p class="tmb-desc"><?php esc_html_e( 'اگر هیچ روزی انتخاب نشود، همه روزها در نظر گرفته می‌شود.', 'tamas-box' ); ?></p>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'از ساعت', 'tamas-box' ); ?></label>
						<input type="time" class="ltr" name="<?php echo esc_attr( $n ); ?>[schedule_from]" value="<?php echo esc_attr( $box['schedule_from'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'تا ساعت', 'tamas-box' ); ?></label>
						<input type="time" class="ltr" name="<?php echo esc_attr( $n ); ?>[schedule_to]" value="<?php echo esc_attr( $box['schedule_to'] ); ?>">
					</div>
				</div>
				<p class="tmb-desc"><?php esc_html_e( 'خالی گذاشتن ساعت‌ها یعنی تمام شبانه‌روز. بازه شبانه مثل ۲۲:۰۰ تا ۰۶:۰۰ هم پشتیبانی می‌شود.', 'tamas-box' ); ?></p>
			</div>

			<div class="tmb-ranges-head">
				<strong><?php esc_html_e( 'بازه‌های اضافی', 'tamas-box' ); ?></strong>
				<button type="button" class="button tmb-add-range">+ <?php esc_html_e( 'افزودن بازه', 'tamas-box' ); ?></button>
			</div>
			<p class="tmb-desc"><?php esc_html_e( 'اگر باکس باید در چند بازه مختلف نمایش داده شود (مثلاً صبح و عصر)، اینجا اضافه کنید. کافی است یکی از بازه‌ها مطابقت داشته باشد.', 'tamas-box' ); ?></p>

			<div class="tmb-ranges-list">
				<?php
				$ri = 0;
				foreach ( (array) $box['schedule_ranges'] as $range ) {
					$this->range_row( $n, $ri, $range, $days );
					$ri++;
				}
				?>
			</div>

			<p class="tmb-desc tmb-sched-now">
				<?php
				/* translators: %s: current site time */
				printf( esc_html__( 'ساعت فعلی سایت شما: %s', 'tamas-box' ), '<code>' . esc_html( current_time( 'H:i' ) ) . '</code>' );
				?>
			</p>
		</div>
		<?php
	}

	/**
	 * One extra time range row.
	 *
	 * @param string     $n     Field prefix.
	 * @param int|string $ri    Range index.
	 * @param array      $range Range data.
	 * @param array      $days  Day labels.
	 */
	protected function range_row( $n, $ri, $range, $days = array() ) {
		if ( empty( $days ) ) {
			$days = TMB_Visibility::days();
		}
		$range = wp_parse_args(
			$range,
			array(
				'days' => array(),
				'from' => '',
				'to'   => '',
			)
		);
		$rn = $n . '[schedule_ranges][' . $ri . ']';
		?>
		<div class="tmb-timeblock tmb-range-row" data-ri="<?php echo esc_attr( $ri ); ?>">
			<div class="tmb-timeblock-head">
				<strong><?php esc_html_e( 'بازه', 'tamas-box' ); ?></strong>
				<button type="button" class="tmb-remove-range" title="<?php esc_attr_e( 'حذف بازه', 'tamas-box' ); ?>">✕</button>
			</div>

			<div class="tmb-field">
				<div class="tmb-checkgrid tmb-daygrid">
					<?php foreach ( $days as $key => $label ) : ?>
						<label class="tmb-checkchip">
							<input type="checkbox" name="<?php echo esc_attr( $rn ); ?>[days][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $range['days'], true ) ); ?>>
							<span><?php echo esc_html( $label ); ?></span>
						</label>
					<?php endforeach; ?>
				</div>
			</div>

			<div class="tmb-grid-2">
				<div class="tmb-field">
					<label><?php esc_html_e( 'از ساعت', 'tamas-box' ); ?></label>
					<input type="time" class="ltr" name="<?php echo esc_attr( $rn ); ?>[from]" value="<?php echo esc_attr( $range['from'] ); ?>">
				</div>
				<div class="tmb-field">
					<label><?php esc_html_e( 'تا ساعت', 'tamas-box' ); ?></label>
					<input type="time" class="ltr" name="<?php echo esc_attr( $rn ); ?>[to]" value="<?php echo esc_attr( $range['to'] ); ?>">
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * One contact item row.
	 *
	 * @param int|string $bi    Box index.
	 * @param int|string $ii    Item index.
	 * @param array      $item  Item data.
	 * @param string     $o     Option name.
	 * @param array      $icons Icons.
	 */
	protected function item_row( $bi, $ii, $item, $o, $icons ) {
		$item = wp_parse_args(
			$item,
			array(
				'enabled'      => 1,
				'action'       => 'link',
				'label'        => '',
				'sublabel'     => '',
				'icon'         => 'link',
				'url'          => '',
				'color'        => '#334155',
				'custom_color' => 0,
				'new_tab'      => 0,
				'nofollow'     => 0,
				'device'       => 'both',
			)
		);
		$name   = $o . '[boxes][' . $bi . '][items][' . $ii . ']';
		$action = ( isset( $item['action'] ) && 'chat' === $item['action'] ) ? 'chat' : 'link';
		$is_chat = ( 'chat' === $action );
		?>
		<div class="tmb-item <?php echo $item['enabled'] ? '' : 'is-off'; ?><?php echo $is_chat ? ' tmb-item-is-chat' : ''; ?>" data-index="<?php echo esc_attr( $ii ); ?>" data-action="<?php echo esc_attr( $action ); ?>">
			<div class="tmb-item-head" role="button" tabindex="0" aria-expanded="false" title="<?php esc_attr_e( 'برای ویرایش کلیک کنید', 'tamas-box' ); ?>">
				<span class="tmb-drag" title="<?php esc_attr_e( 'جابجایی', 'tamas-box' ); ?>">⋮⋮</span>
				<span class="tmb-item-icon" style="background:<?php echo esc_attr( $item['custom_color'] ? $item['color'] : TMB_Icons::color( $item['icon'] ) ); ?>">
					<?php echo TMB_Icons::svg( $item['icon'] ); // phpcs:ignore ?>
				</span>
				<span class="tmb-item-title">
					<?php echo esc_html( $item['label'] ? $item['label'] : __( 'بدون عنوان', 'tamas-box' ) ); ?>
					<small><?php esc_html_e( 'کلیک برای ویرایش', 'tamas-box' ); ?></small>
				</span>
				<label class="tmb-switch small" title="<?php esc_attr_e( 'فعال / غیرفعال', 'tamas-box' ); ?>">
					<input type="checkbox" class="tmb-item-enabled" name="<?php echo esc_attr( $name ); ?>[enabled]" value="1" <?php checked( $item['enabled'], 1 ); ?>>
					<span class="tmb-slider"></span>
				</label>
				<button type="button" class="tmb-toggle-item" title="<?php esc_attr_e( 'ویرایش', 'tamas-box' ); ?>" aria-label="<?php esc_attr_e( 'ویرایش آیتم', 'tamas-box' ); ?>">✎</button>
				<button type="button" class="tmb-remove-item" title="<?php esc_attr_e( 'حذف', 'tamas-box' ); ?>" aria-label="<?php esc_attr_e( 'حذف آیتم', 'tamas-box' ); ?>">✕</button>
			</div>

			<div class="tmb-item-body">
				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'نوع آیتم', 'tamas-box' ); ?></label>
						<select class="tmb-item-action" name="<?php echo esc_attr( $name ); ?>[action]">
							<option value="link" <?php selected( $action, 'link' ); ?>><?php esc_html_e( 'لینک / شماره', 'tamas-box' ); ?></option>
							<option value="chat" <?php selected( $action, 'chat' ); ?>><?php esc_html_e( 'چت آنلاین (باز کردن پنجره چت)', 'tamas-box' ); ?></option>
						</select>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'عنوان', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-item-label" name="<?php echo esc_attr( $name ); ?>[label]" value="<?php echo esc_attr( $item['label'] ); ?>" placeholder="<?php esc_attr_e( 'مثلاً ارتباط از طریق واتساپ', 'tamas-box' ); ?>">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'توضیح کوتاه (اختیاری)', 'tamas-box' ); ?></label>
					<input type="text" class="tmb-item-sub" name="<?php echo esc_attr( $name ); ?>[sublabel]" value="<?php echo esc_attr( $item['sublabel'] ); ?>" placeholder="<?php esc_attr_e( 'پاسخگویی ۹ تا ۱۸', 'tamas-box' ); ?>">
				</div>

				<div class="tmb-field tmb-item-url-field">
					<label><?php esc_html_e( 'لینک / شماره', 'tamas-box' ); ?></label>
					<input type="text" class="tmb-item-url ltr" name="<?php echo esc_attr( $name ); ?>[url]" value="<?php echo esc_attr( $item['url'] ); ?>" placeholder="tel:09121234567">
					<p class="tmb-desc">
						<?php esc_html_e( 'تماس مستقیم:', 'tamas-box' ); ?> <code>tel:09121234567</code> ·
						<?php esc_html_e( 'واتساپ:', 'tamas-box' ); ?> <code>https://wa.me/98912...</code>
					</p>
				</div>

				<div class="tmb-field tmb-item-chat-note" hidden>
					<p class="tmb-note tmb-note-ok">
						💬 <?php esc_html_e( 'این آیتم پنجره چت آنلاین را باز می‌کند. برای کار کردن، «چت آنلاین» را در تب چت فعال و بازو بله را متصل کنید.', 'tamas-box' ); ?>
					</p>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'آیکون', 'tamas-box' ); ?></label>
					<div class="tmb-iconpick item-iconpick">
						<?php foreach ( $icons as $key => $data ) : ?>
							<button type="button" class="tmb-iconopt <?php echo $item['icon'] === $key ? 'selected' : ''; ?>" data-icon="<?php echo esc_attr( $key ); ?>" data-color="<?php echo esc_attr( $data['color'] ); ?>" title="<?php echo esc_attr( $data['label'] ); ?>">
								<?php echo TMB_Icons::svg( $key ); // phpcs:ignore ?>
							</button>
						<?php endforeach; ?>
					</div>
					<input type="hidden" class="tmb-item-icon-input" name="<?php echo esc_attr( $name ); ?>[icon]" value="<?php echo esc_attr( $item['icon'] ); ?>">
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label class="tmb-check">
							<input type="checkbox" class="tmb-item-customcolor" name="<?php echo esc_attr( $name ); ?>[custom_color]" value="1" <?php checked( $item['custom_color'], 1 ); ?>>
							<?php esc_html_e( 'رنگ دلخواه', 'tamas-box' ); ?>
						</label>
						<input type="text" class="tmb-color tmb-item-color" name="<?php echo esc_attr( $name ); ?>[color]" value="<?php echo esc_attr( $item['color'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'نمایش در', 'tamas-box' ); ?></label>
						<select name="<?php echo esc_attr( $name ); ?>[device]">
							<option value="both" <?php selected( $item['device'], 'both' ); ?>><?php esc_html_e( 'همه دستگاه‌ها', 'tamas-box' ); ?></option>
							<option value="desktop" <?php selected( $item['device'], 'desktop' ); ?>><?php esc_html_e( 'فقط دسکتاپ', 'tamas-box' ); ?></option>
							<option value="mobile" <?php selected( $item['device'], 'mobile' ); ?>><?php esc_html_e( 'فقط موبایل', 'tamas-box' ); ?></option>
						</select>
					</div>
					<div class="tmb-field">
						<label class="tmb-check">
							<input type="checkbox" name="<?php echo esc_attr( $name ); ?>[new_tab]" value="1" <?php checked( $item['new_tab'], 1 ); ?>>
							<?php esc_html_e( 'تب جدید', 'tamas-box' ); ?>
						</label>
						<label class="tmb-check">
							<input type="checkbox" name="<?php echo esc_attr( $name ); ?>[nofollow]" value="1" <?php checked( $item['nofollow'], 1 ); ?>>
							<?php esc_html_e( 'nofollow', 'tamas-box' ); ?>
						</label>
					</div>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * JS template: a whole new box.
	 *
	 * @param string $o     Option name.
	 * @param array  $icons Icons.
	 */
	protected function box_template( $o, $icons ) {
		echo '<script type="text/html" id="tmpl-tmb-box">';
		$this->box_panel(
			'__b__',
			TMB_Settings::box_defaults(
				array(
					'id'    => '__id__',
					'name'  => __( 'باکس جدید', 'tamas-box' ),
					'items' => array(),
				)
			),
			$o,
			$icons
		);
		echo '</script>';
	}

	/**
	 * JS template: a new item.
	 *
	 * @param string $o     Option name.
	 * @param array  $icons Icons.
	 */
	protected function item_template( $o, $icons ) {
		echo '<script type="text/html" id="tmpl-tmb-item">';
		$this->item_row(
			'__b__',
			'__i__',
			array(
				'enabled'      => 1,
				'action'       => 'link',
				'label'        => '',
				'sublabel'     => '',
				'icon'         => 'link',
				'url'          => '',
				'color'        => '#334155',
				'custom_color' => 0,
				'new_tab'      => 1,
				'nofollow'     => 1,
				'device'       => 'both',
			),
			$o,
			$icons
		);
		echo '</script>';
	}

	/**
	 * JS template: a new time range.
	 *
	 * @param string $o Option name.
	 */
	protected function range_template( $o ) {
		echo '<script type="text/html" id="tmpl-tmb-range">';
		$this->range_row( $o . '[boxes][__b__]', '__r__', array() );
		echo '</script>';
	}

	/**
	 * Help screen.
	 */
	public function render_help() {
		?>
		<div class="wrap tmb-wrap" dir="rtl">
			<h1><?php esc_html_e( 'راهنمای افزونه تماس باکس', 'tamas-box' ); ?></h1>

			<div class="tmb-help">
				<h2><?php esc_html_e( '۱. تماس مستقیم با یک کلیک', 'tamas-box' ); ?></h2>
				<p><?php esc_html_e( 'در فیلد «لینک / شماره» آیتم، عبارت tel: را قبل از شماره بنویسید. مثال:', 'tamas-box' ); ?> <code>tel:09121234567</code></p>
				<p><?php esc_html_e( 'با کلیک روی این آیتم در موبایل، شماره مستقیماً در برنامه تلفن وارد می‌شود.', 'tamas-box' ); ?></p>

				<h2><?php esc_html_e( '۲. چند باکس تماس', 'tamas-box' ); ?></h2>
				<p><?php esc_html_e( 'در تب «باکس‌های تماس» با دکمه «باکس جدید» هر تعداد باکس که بخواهید می‌سازید. هر باکس تنظیمات کاملاً مستقل دارد:', 'tamas-box' ); ?></p>
				<ul class="tmb-ul">
					<li><?php esc_html_e( 'موقعیت جداگانه روی صفحه', 'tamas-box' ); ?></li>
					<li><?php esc_html_e( 'رنگ، آیکون و متن جداگانه', 'tamas-box' ); ?></li>
					<li><?php esc_html_e( 'آیتم‌های ارتباطی جداگانه', 'tamas-box' ); ?></li>
					<li><?php esc_html_e( 'صفحات نمایش جداگانه', 'tamas-box' ); ?></li>
					<li><?php esc_html_e( 'روزها و ساعت‌های نمایش جداگانه', 'tamas-box' ); ?></li>
				</ul>
				<p class="tmb-note">
					<strong><?php esc_html_e( 'مثال کاربردی:', 'tamas-box' ); ?></strong>
					<?php esc_html_e( 'یک باکس «پشتیبانی تلفنی» بسازید که شنبه تا چهارشنبه ساعت ۹ تا ۱۸ نمایش داده شود، و یک باکس دوم «پیام بگذارید» که فقط خارج از این ساعت‌ها ظاهر شود.', 'tamas-box' ); ?>
				</p>

				<h2><?php esc_html_e( '۳. موقعیت باکس روی صفحه', 'tamas-box' ); ?></h2>
				<p><?php esc_html_e( 'در تب «موقعیت» هر باکس، از شبکه ۳×۳ محل دلخواه را انتخاب کنید:', 'tamas-box' ); ?></p>
				<ul class="tmb-ul">
					<li><?php esc_html_e( 'بالا چپ، بالا وسط، بالا راست', 'tamas-box' ); ?></li>
					<li><?php esc_html_e( 'وسط چپ، وسط راست', 'tamas-box' ); ?></li>
					<li><?php esc_html_e( 'پایین چپ، پایین وسط، پایین راست', 'tamas-box' ); ?></li>
				</ul>
				<p><?php esc_html_e( 'اگر چند باکس در یک موقعیت باشند، خودکار روی هم چیده می‌شوند تا همپوشانی نداشته باشند. در موبایل همه باکس‌ها به‌صورت منوی کشویی از پایین باز می‌شوند.', 'tamas-box' ); ?></p>

				<h2><?php esc_html_e( '۴. زمان‌بندی نمایش', 'tamas-box' ); ?></h2>
				<p><?php esc_html_e( 'در تب «زمان‌بندی» هر باکس می‌توانید روزهای هفته و بازه ساعتی تعیین کنید. با دکمه «افزودن بازه» چند بازه مختلف بسازید؛ کافی است یکی از آن‌ها مطابقت داشته باشد.', 'tamas-box' ); ?></p>
				<table class="widefat striped tmb-table">
					<thead><tr><th><?php esc_html_e( 'تنظیم', 'tamas-box' ); ?></th><th><?php esc_html_e( 'نتیجه', 'tamas-box' ); ?></th></tr></thead>
					<tbody>
						<tr><td><?php esc_html_e( 'روز خالی', 'tamas-box' ); ?></td><td><?php esc_html_e( 'همه روزهای هفته', 'tamas-box' ); ?></td></tr>
						<tr><td><?php esc_html_e( 'ساعت خالی', 'tamas-box' ); ?></td><td><?php esc_html_e( 'تمام شبانه‌روز', 'tamas-box' ); ?></td></tr>
						<tr><td><code>09:00 → 18:00</code></td><td><?php esc_html_e( 'فقط در ساعات کاری', 'tamas-box' ); ?></td></tr>
						<tr><td><code>22:00 → 06:00</code></td><td><?php esc_html_e( 'بازه شبانه (از شب تا صبح روز بعد)', 'tamas-box' ); ?></td></tr>
					</tbody>
				</table>

				<h2><?php esc_html_e( '۵. تعیین صفحات نمایش', 'tamas-box' ); ?></h2>
				<p><?php esc_html_e( 'در تب «صفحات» هر باکس دو حالت دارید:', 'tamas-box' ); ?></p>
				<ul class="tmb-ul">
					<li><strong><?php esc_html_e( 'در همه صفحات:', 'tamas-box' ); ?></strong> <?php esc_html_e( 'همه‌جا هست، فقط موارد کادر قرمز مستثنی می‌شوند.', 'tamas-box' ); ?></li>
					<li><strong><?php esc_html_e( 'فقط در صفحات انتخابی:', 'tamas-box' ); ?></strong> <?php esc_html_e( 'فقط در موارد کادر سبز ظاهر می‌شود.', 'tamas-box' ); ?></li>
				</ul>
				<p><?php esc_html_e( 'فیلترها: نوع صفحه، صفحات ووکامرس، نوع محتوا، شناسه صفحه، شناسه دسته، آدرس URL (با پشتیبانی از *) و نقش کاربری.', 'tamas-box' ); ?></p>

				<h2><?php esc_html_e( '۶. نمونه لینک‌ها', 'tamas-box' ); ?></h2>
				<table class="widefat striped tmb-table">
					<thead><tr><th><?php esc_html_e( 'سرویس', 'tamas-box' ); ?></th><th><?php esc_html_e( 'قالب لینک', 'tamas-box' ); ?></th></tr></thead>
					<tbody>
						<tr><td><?php esc_html_e( 'تماس تلفنی', 'tamas-box' ); ?></td><td><code>tel:02112345678</code></td></tr>
						<tr><td><?php esc_html_e( 'پیامک', 'tamas-box' ); ?></td><td><code>sms:09121234567</code></td></tr>
						<tr><td><?php esc_html_e( 'ایمیل', 'tamas-box' ); ?></td><td><code>mailto:info@site.com</code></td></tr>
						<tr><td><?php esc_html_e( 'واتساپ', 'tamas-box' ); ?></td><td><code>https://wa.me/989121234567</code></td></tr>
						<tr><td><?php esc_html_e( 'تلگرام', 'tamas-box' ); ?></td><td><code>https://t.me/username</code></td></tr>
						<tr><td><?php esc_html_e( 'ایتا', 'tamas-box' ); ?></td><td><code>https://eitaa.com/username</code></td></tr>
						<tr><td><?php esc_html_e( 'بله', 'tamas-box' ); ?></td><td><code>https://ble.ir/username</code></td></tr>
						<tr><td><?php esc_html_e( 'روبیکا', 'tamas-box' ); ?></td><td><code>https://rubika.ir/username</code></td></tr>
						<tr><td><?php esc_html_e( 'اینستاگرام', 'tamas-box' ); ?></td><td><code>https://instagram.com/username</code></td></tr>
						<tr><td><?php esc_html_e( 'یوتیوب', 'tamas-box' ); ?></td><td><code>https://youtube.com/@channel</code></td></tr>
						<tr><td><?php esc_html_e( 'آپارات', 'tamas-box' ); ?></td><td><code>https://aparat.com/username</code></td></tr>
					</tbody>
				</table>

				<h2><?php esc_html_e( '۷. شورتکدها', 'tamas-box' ); ?></h2>
				<p><code>[tamas_box]</code> — <?php esc_html_e( 'باکس ثابت داخل محتوا (اولین باکس).', 'tamas-box' ); ?></p>
				<p><code>[tamas_box id="box2"]</code> — <?php esc_html_e( 'باکس مشخص با شناسه.', 'tamas-box' ); ?></p>
				<p><code>[tamas_button id="box2" text="تماس"]</code> — <?php esc_html_e( 'دکمه‌ای که باکس مورد نظر را باز می‌کند.', 'tamas-box' ); ?></p>

				<h2><?php esc_html_e( '۸. برای توسعه‌دهنده', 'tamas-box' ); ?></h2>
				<pre class="tmb-pre">// آیکون سفارشی
add_filter( 'tmb_icons', function( $icons ) {
    $icons['myicon'] = array(
        'label' =&gt; 'آیکون من',
        'color' =&gt; '#ff0000',
        'svg'   =&gt; '&lt;path d="..."/&gt;',
    );
    return $icons;
} );

// کنترل نمایش یک باکس خاص
add_filter( 'tmb_box_should_render', function( $show, $box ) {
    if ( 'box2' === $box['id'] &amp;&amp; is_front_page() ) {
        return false;
    }
    return $show;
}, 10, 2 );</pre>

				<h3><?php esc_html_e( 'API جاوااسکریپت', 'tamas-box' ); ?></h3>
				<pre class="tmb-pre">TamasBox.open( 'box2' );
TamasBox.close( 'box2' );
TamasBox.toggle( 'box2' );
TamasBox.boxes();   // ['box1','box2']

document.addEventListener( 'tmb:open', function( e ) {
    console.log( e.detail.id );
} );</pre>

				<div class="tmb-credit">
					<strong><?php esc_html_e( 'افزونه تماس باکس', 'tamas-box' ); ?></strong>
					<span><?php esc_html_e( 'نسخه', 'tamas-box' ); ?> <?php echo esc_html( TMB_VERSION ); ?></span>
					<span><?php esc_html_e( 'طراحی و توسعه:', 'tamas-box' ); ?> <?php echo esc_html( TMB_AUTHOR ); ?></span>
					<a href="<?php echo esc_url( TMB_AUTHOR_URL ); ?>" target="_blank" rel="noopener">www.mrkhodabakhshi.ir</a>
				</div>
			</div>
		</div>
		<?php
	}
}
